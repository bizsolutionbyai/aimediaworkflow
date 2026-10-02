// Integration API for MarketingOS / Product Media Agent: /api/v1/*
// Token-authenticated (INTEGRATION_TOKEN), stable request/response shapes, and composite operations
// (create a production space from a product record in one call). Internally it reuses the regular
// /api routes via app.inject, so behaviour (validation, versioning, checks) is identical to the UI.
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { REFERENCE_TYPES, type ReferenceType } from "@amw/shared";
import type { AppContext } from "../app";
import { BadRequestError, NotFoundError } from "../repo";
import { readMarkdownFolder } from "../services/markdown";
import { kindFromMime, mimeFromName, recordAsset, resolveData } from "../services/storage";

const MAX_DOWNLOAD = 50 * 1024 * 1024;

interface ImageInput {
  url?: string;
  base64?: string;
  filename?: string;
}

interface ReferenceInput {
  type: ReferenceType;
  code?: string;
  name?: string;
  description?: string;
  prompt?: string;
  settings?: Record<string, unknown>;
  images?: ImageInput[];
}

interface CreateSpaceBody {
  project: { id?: string; name: string; description?: string };
  space: { name: string; description?: string; targetPlatform?: string; aspectRatio?: string };
  references?: ReferenceInput[];
  masterScript?: Record<string, unknown>;
  /** Scene drafts; when omitted and storyboard.generate is true, the master script is split. */
  scenes?: Record<string, unknown>[];
  storyboard?: { generate?: boolean; includeVoice?: boolean };
}

function tokenOk(header: string | undefined, token: string): boolean {
  const got = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function integrationRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;
  const fetchImpl = ctx.fetch;

  /** Calls an internal /api route and returns its JSON, re-throwing errors with the same status. */
  async function call<T = any>(method: string, url: string, payload?: unknown): Promise<T> {
    const res = await app.inject({ method: method as never, url, payload: payload as never });
    const data = res.body ? JSON.parse(res.body) : null;
    if (res.statusCode >= 400) {
      const err = new Error(data?.error ?? `HTTP ${res.statusCode}`) as Error & { statusCode: number; data: unknown };
      err.statusCode = res.statusCode;
      err.data = data;
      throw err;
    }
    return data as T;
  }

  async function fetchImage(img: ImageInput, i: number): Promise<{ bytes: Buffer; filename: string; mime: string }> {
    if (img.base64) {
      const filename = img.filename || `image_${i + 1}.png`;
      return { bytes: Buffer.from(img.base64, "base64"), filename, mime: mimeFromName(filename) };
    }
    if (!img.url || !/^https?:\/\//i.test(img.url)) throw new BadRequestError("image needs an http(s) url or base64");
    const res = await fetchImpl(img.url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new BadRequestError(`download failed (${res.status}): ${img.url}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD) throw new BadRequestError(`image too large: ${img.url}`);
    const fromUrl = path.basename(new URL(img.url).pathname) || `image_${i + 1}`;
    const filename = img.filename || fromUrl;
    const header = res.headers.get("content-type")?.split(";")[0] ?? "";
    return { bytes, filename, mime: header && header !== "application/octet-stream" ? header : mimeFromName(filename) };
  }

  app.register(async (v1) => {
    v1.addHook("onRequest", async (req, reply: FastifyReply) => {
      const token = cfg.env.INTEGRATION_TOKEN?.trim();
      if (!token) return reply.code(503).send({ error: "Integration API disabled: set INTEGRATION_TOKEN in .env", code: "integration_disabled" });
      if (!tokenOk(req.headers.authorization, token)) return reply.code(401).send({ error: "Invalid or missing bearer token", code: "unauthorized" });
    });

    v1.get("/health", async () => ({ ok: true, version: "v1", providers: ctx.registry.list(), defaults: ctx.registry.defaults() }));

    /** Create (or reuse) a project and create a production space from a product record, in one call. */
    v1.post("/spaces", async (req, reply) => {
      const b = (req.body ?? {}) as CreateSpaceBody;
      if (!b.project?.name && !b.project?.id) throw new BadRequestError("project.name (or project.id) is required");
      if (!b.space?.name) throw new BadRequestError("space.name is required");

      let project = b.project.id ? await db.project.findUnique({ where: { id: b.project.id } }) : await db.project.findFirst({ where: { name: b.project.name } });
      if (!project) project = await call("POST", "/api/projects", { name: b.project.name, description: b.project.description ?? "" });
      const space = await call("POST", `/api/projects/${project!.id}/spaces`, b.space);

      const references = [];
      for (const r of b.references ?? []) {
        if (!REFERENCE_TYPES.includes(r.type)) throw new BadRequestError(`invalid reference type ${String(r.type)}`);
        const assetIds: string[] = [];
        for (const [i, img] of (r.images ?? []).entries()) {
          const f = await fetchImage(img, i);
          const asset = await recordAsset(db, cfg.dataDir, { projectId: project!.id, spaceId: space.id, filename: f.filename, mimeType: f.mime, kind: kindFromMime(f.mime), bytes: f.bytes });
          assetIds.push(asset.id);
        }
        references.push(await call("POST", `/api/spaces/${space.id}/references`, { type: r.type, code: r.code, name: r.name, description: r.description, prompt: r.prompt, settings: r.settings, assetIds }));
      }

      let masterScript = null;
      if (b.masterScript) {
        const ms = { ...b.masterScript };
        // Default the master script references to the first character/product/style/voice supplied.
        for (const [field, type] of [["characterId", "character"], ["productId", "product"], ["styleId", "style"], ["voiceId", "voice"]] as const) {
          if (ms[field] === undefined) {
            const ref = references.find((x: { type: string }) => x.type === type);
            if (ref) ms[field] = ref.code;
          }
        }
        masterScript = await call("PUT", `/api/spaces/${space.id}/master-script`, ms);
      }

      let scenes: unknown[] = [];
      if (b.scenes?.length || b.storyboard?.generate) {
        const r = await call("POST", `/api/spaces/${space.id}/storyboard`, { mode: "replace", scenes: b.scenes?.length ? b.scenes : undefined, includeVoice: !!b.storyboard?.includeVoice });
        scenes = r.scenes;
      }
      reply.code(201);
      return { projectId: project!.id, spaceId: space.id, references, masterScript, scenes, check: await call("POST", `/api/spaces/${space.id}/check`) };
    });

    v1.get<{ Params: { id: string } }>("/spaces/:id", async (req) => {
      const bundle = await call("GET", `/api/spaces/${req.params.id}/bundle`);
      return {
        ...bundle,
        outputs: bundle.outputs.map((o: { id: string; path: string }) => ({ ...o, url: `/api/v1/outputs/${o.id}/file` })),
      };
    });

    v1.put<{ Params: { id: string } }>("/spaces/:id/master-script", async (req) => call("PUT", `/api/spaces/${req.params.id}/master-script`, req.body));
    v1.post<{ Params: { id: string } }>("/spaces/:id/storyboard", async (req) => call("POST", `/api/spaces/${req.params.id}/storyboard`, req.body ?? {}));
    v1.post<{ Params: { id: string } }>("/spaces/:id/scenes", async (req) => call("POST", `/api/spaces/${req.params.id}/scenes`, req.body ?? {}));
    v1.patch<{ Params: { id: string } }>("/scenes/:id", async (req) => call("PATCH", `/api/scenes/${req.params.id}`, req.body ?? {}));
    v1.get<{ Params: { id: string }; Querystring: { target?: string } }>("/scenes/:id/prompt", async (req) =>
      call("GET", `/api/scenes/${req.params.id}/prompt-preview?target=${encodeURIComponent(req.query.target ?? "image")}`),
    );
    v1.put<{ Params: { id: string } }>("/spaces/:id/workflow", async (req) => call("PUT", `/api/spaces/${req.params.id}/workflow`, req.body));
    v1.post<{ Params: { id: string } }>("/spaces/:id/check", async (req) => call("POST", `/api/spaces/${req.params.id}/check`));

    /** Start a run. Body: { targets?: string[], mode?: "missing"|"all", webhookUrl?: string }. */
    v1.post<{ Params: { id: string } }>("/spaces/:id/runs", async (req, reply) => {
      const b = (req.body ?? {}) as { targets?: string[]; mode?: "missing" | "all"; webhookUrl?: string };
      if (b.webhookUrl && !/^https?:\/\//i.test(b.webhookUrl)) throw new BadRequestError("webhookUrl must be http(s)");
      const r = await ctx.engine.start(req.params.id, { targets: b.targets, mode: b.mode === "all" ? "all" : "missing", webhookUrl: b.webhookUrl });
      reply.code(202);
      return r;
    });
    v1.get<{ Params: { id: string } }>("/runs/:id", async (req) => call("GET", `/api/runs/${req.params.id}`));
    v1.post<{ Params: { id: string } }>("/runs/:id/cancel", async (req) => call("POST", `/api/runs/${req.params.id}/cancel`));

    v1.get<{ Params: { id: string } }>("/outputs/:id/file", async (req, reply) => {
      const o = await db.output.findUnique({ where: { id: req.params.id } });
      if (!o) throw new NotFoundError("Output");
      const abs = resolveData(cfg.dataDir, o.path);
      if (!fs.existsSync(abs)) throw new NotFoundError("Output file");
      reply.header("content-type", mimeFromName(abs));
      reply.header("content-disposition", `attachment; filename="${path.basename(abs)}"`);
      return reply.send(fs.createReadStream(abs));
    });
    v1.post<{ Params: { id: string } }>("/outputs/:id/select", async (req) => call("POST", `/api/outputs/${req.params.id}/select`));

    /** Export and return the Markdown files inline: { folder, files: { "PROJECT.md": "...", ... } }. */
    v1.post<{ Params: { id: string } }>("/spaces/:id/export", async (req) => {
      const r = await call("POST", `/api/spaces/${req.params.id}/export`, req.body ?? {});
      return { folder: r.folder, mediaCount: r.mediaCount, files: readMarkdownFolder(r.absoluteDir) };
    });
    /** Import Markdown: { files: { path: content }, media?: { "assets/...": base64 }, removeMissingScenes? }. */
    v1.post("/import", async (req) => call("POST", "/api/import", req.body));
  }, { prefix: "/api/v1" });
}
