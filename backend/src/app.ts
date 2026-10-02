// Fastify application factory (used by server.ts and by the integration tests).
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyError } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { MarkdownImportError, WorkflowError } from "@amw/shared";
import { ProviderError, ProviderNotConfiguredError, ProviderRegistry } from "@amw/providers";
import { loadConfig, type AppConfig } from "./config";
import { createDb, type Db } from "./db";
import { coreRoutes, seedPrompts } from "./routes/core";
import { integrationRoutes } from "./routes/integration";
import { opsRoutes } from "./routes/ops";
import { Assistant } from "./services/assistant";
import { RunBlockedError, WorkflowEngine } from "./services/engine";

export interface AppContext {
  cfg: AppConfig;
  db: Db;
  registry: ProviderRegistry;
  engine: WorkflowEngine;
  assistant: Assistant;
  fetch: typeof fetch;
}

export interface BuildOptions {
  config?: Partial<AppConfig>;
  fetch?: typeof fetch;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}) {
  const cfg = loadConfig(opts.config);
  const db = createDb(cfg.dataDir);
  const registry = new ProviderRegistry(cfg.env);
  const fetchImpl = opts.fetch ?? fetch;
  const assistant = new Assistant(db, registry, cfg, fetchImpl);
  const engine = new WorkflowEngine(db, registry, cfg, assistant, fetchImpl);
  const ctx: AppContext = { cfg, db, registry, engine, assistant, fetch: fetchImpl };

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: path.join(cfg.dataDir, "assets"), prefix: "/files/assets/", decorateReply: false });
  await app.register(fastifyStatic, { root: path.join(cfg.dataDir, "outputs"), prefix: "/files/outputs/", decorateReply: false });

  const dist = path.join(cfg.rootDir, "frontend", "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, prefix: "/", decorateReply: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/files/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((err: FastifyError & { code?: string; report?: unknown }, _req, reply) => {
    if (err instanceof RunBlockedError) return reply.code(422).send({ error: err.message, code: "workflow_check_failed", report: err.report, blocking: err.blocking });
    if (err instanceof ProviderNotConfiguredError) return reply.code(503).send({ error: err.message, code: "provider_not_configured" });
    if (err instanceof ProviderError) return reply.code(502).send({ error: err.message, code: "provider_error" });
    if (err instanceof WorkflowError) return reply.code(400).send({ error: err.message, details: err.details });
    if (err instanceof MarkdownImportError) return reply.code(400).send({ error: err.message });
    if (err.code === "P2002") return reply.code(409).send({ error: "A record with this id/code already exists" });
    if (err.code === "P2025") return reply.code(404).send({ error: "Not found" });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: err.message });
  });

  coreRoutes(app, ctx);
  opsRoutes(app, ctx);
  integrationRoutes(app, ctx);

  await seedPrompts(ctx);
  await engine.recover();
  app.addHook("onClose", async () => {
    await db.$disconnect();
  });
  return { app, ctx };
}
