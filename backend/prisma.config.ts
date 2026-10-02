import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

// The SQLite file lives in <repo>/data/app.db unless DATA_DIR overrides the data directory.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "..", process.env.DATA_DIR ?? "data");

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Forward slashes keep the SQLite URL valid on Windows too.
  datasource: { url: `file:${path.join(dataDir, "app.db").split(path.sep).join("/")}` },
});
