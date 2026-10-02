// Live provider smoke test: makes ONE real, minimal call per selected provider using the keys in .env
// and saves the result under data/smoke/. Costs a little provider credit.
//   npm run smoke                 → lists providers and whether they are configured
//   npm run smoke -- openai-image → runs that provider (or "all" for every configured one)
import fs from "node:fs";
import path from "node:path";
import { ProviderRegistry, type MediaFile, type ProviderContext } from "@amw/providers";
import { loadConfig } from "./config";

const cfg = loadConfig();
const registry = new ProviderRegistry(cfg.env);
const arg = process.argv[2];
const list = registry.list();

if (!arg) {
  for (const p of list) console.log(`${p.configured ? "✓" : "✕"} ${p.id.padEnd(18)} ${p.kind.padEnd(8)} ${p.envKey}${p.configured ? "" : " (not set)"}`);
  console.log('\nRun: npm run smoke -- <provider-id> | all');
  process.exit(0);
}

const ids = arg === "all" ? list.filter((p) => p.configured).map((p) => p.id) : [arg];
const outDir = path.join(cfg.dataDir, "smoke");
fs.mkdirSync(outDir, { recursive: true });
const ctx = (id: string): ProviderContext => ({ env: cfg.env, fetch, log: (m) => console.log(`  [${id}] ${m}`) });
const latestImage = (): MediaFile | undefined => {
  const f = fs.readdirSync(outDir).filter((x) => /\.(png|jpe?g|webp)$/.test(x)).sort().pop();
  return f ? { data: new Uint8Array(fs.readFileSync(path.join(outDir, f))), mimeType: f.endsWith("png") ? "image/png" : "image/jpeg", filename: f } : undefined;
};

let failed = 0;
for (const id of ids) {
  const p = registry.get(id);
  if (!p) {
    console.error(`Unknown provider ${id}`);
    failed++;
    continue;
  }
  console.log(`\n▶ ${id}`);
  const started = Date.now();
  try {
    let saved: string[] = [];
    const save = (r: { data: Uint8Array; ext: string }[]) =>
      (saved = r.map((m, i) => {
        const f = path.join(outDir, `${Date.now()}_${id}_${i}.${m.ext}`);
        fs.writeFileSync(f, m.data);
        return f;
      }));
    if (p.kind === "image") save(await p.generateImage({ prompt: "A small green shampoo bottle on a white table, product photo", aspectRatio: "1:1", count: 1, referenceImages: [] }, ctx(id)));
    else if (p.kind === "voice") save(await p.generateVoice({ text: "Xin chào, đây là bài kiểm tra giọng nói.", instructions: "warm and friendly", voice: "" }, ctx(id)));
    else if (p.kind === "llm") console.log("  reply:", (await p.complete({ system: "Reply in one short sentence.", prompt: "Say hello." }, ctx(id))).slice(0, 200));
    else if (p.kind === "video") {
      const img = latestImage();
      if (!img) throw new Error("run an image provider smoke test first (video uses the latest smoke image as input)");
      save(await p.generateVideo({ prompt: "Slow push in on the product", aspectRatio: "9:16", duration: 4, inputImage: img }, ctx(id)));
    } else {
      console.log("  skipped: lip-sync needs a video and audio file; test it from the app");
    }
    console.log(`  ✓ ok in ${((Date.now() - started) / 1000).toFixed(1)}s ${saved.join(", ")}`);
  } catch (e) {
    failed++;
    console.error(`  ✕ ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
