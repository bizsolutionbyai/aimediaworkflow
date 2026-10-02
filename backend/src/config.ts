// Runtime configuration. Secrets come only from the environment / .env and are never persisted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface AppConfig {
  rootDir: string;
  dataDir: string;
  exportDir: string;
  port: number;
  host: string;
  env: Record<string, string | undefined>;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  dotenv.config({ path: path.join(ROOT_DIR, ".env"), quiet: true });
  const env = { ...process.env, ...(overrides.env ?? {}) };
  const dataDir = overrides.dataDir ?? path.resolve(ROOT_DIR, env.DATA_DIR || "data");
  const exportDir = overrides.exportDir ?? path.resolve(ROOT_DIR, env.EXPORT_DIR || "exports");
  for (const sub of ["projects", "assets", "outputs", "workflows", "prompts", "scripts", "exports", "logs"]) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
  fs.mkdirSync(exportDir, { recursive: true });
  return {
    rootDir: ROOT_DIR,
    dataDir,
    exportDir,
    port: overrides.port ?? Number(env.PORT || 8787),
    host: overrides.host ?? (env.HOST || "127.0.0.1"),
    env,
  };
}
