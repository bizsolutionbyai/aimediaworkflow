// Applies SQL migrations from backend/prisma/migrations/<NNNN_name>/migration.sql to data/app.db.
// Runs automatically at server start, so end users never need the Prisma CLI or its schema engine.
// Developers: after changing schema.prisma, add a new folder with
//   npx prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");

export function migrate(dataDir: string, log: (m: string) => void = () => {}): string[] {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "app.db"));
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`CREATE TABLE IF NOT EXISTS "_amw_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const applied = new Set((db.prepare(`SELECT name FROM "_amw_migrations"`).all() as { name: string }[]).map((r) => r.name));
    const names = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    // Databases created earlier with `prisma db push` already contain the initial schema.
    const hasProject = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='Project'`).get();
    if (hasProject && !applied.size && names[0]) {
      db.prepare(`INSERT INTO "_amw_migrations" (name) VALUES (?)`).run(names[0]);
      applied.add(names[0]);
    }
    const done: string[] = [];
    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      db.transaction(() => {
        db.exec(sql);
        db.prepare(`INSERT INTO "_amw_migrations" (name) VALUES (?)`).run(name);
      })();
      log(`Applied database migration ${name}`);
      done.push(name);
    }
    return done;
  } finally {
    db.close();
  }
}

// `npm run setup` / `tsx src/migrate.ts`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import("./config");
  const cfg = loadConfig();
  const done = migrate(cfg.dataDir, console.log);
  console.log(done.length ? `Database ready (${done.length} migration(s) applied): ${cfg.dataDir}` : `Database up to date: ${cfg.dataDir}`);
}
