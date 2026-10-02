import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

export type Db = PrismaClient;

export function createDb(dataDir: string): Db {
  const adapter = new PrismaBetterSqlite3({ url: `file:${path.join(dataDir, "app.db")}` });
  return new PrismaClient({ adapter });
}
