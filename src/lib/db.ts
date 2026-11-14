import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  exec?: (sql: string) => Promise<unknown>;
};

type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const globalForPg = globalThis as typeof globalThis & { _pgPool?: pg.Pool };
const globalForPglite = globalThis as typeof globalThis & { _pglite?: Promise<PgClient> };

function pool() {
  globalForPg._pgPool ??= new pg.Pool({ connectionString: databaseUrl });
  return globalForPg._pgPool;
}

async function pglite() {
  globalForPglite._pglite ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite() as PgClient;
    const files = (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      await db.exec?.(await readFile(`migrations/${file}`, "utf8"));
    }
    return db;
  })();
  return globalForPglite._pglite;
}

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return enqueue(async () => {
    if (databaseUrl !== "") {
      const result = await pool().query(text, params);
      return result.rows as T[];
    }
    const result = await (await pglite()).query(text, params);
    return result.rows as T[];
  });
}

export function transaction<T>(fn: (query: Query) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    if (databaseUrl !== "") {
      const client = await pool().connect();
      try {
        await client.query("begin");
        const result = await fn(async (text, params = []) => (await client.query(text, params)).rows as never);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    const db = await pglite();
    await db.exec?.("begin");
    try {
      const result = await fn(async (text, params = []) => (await db.query(text, params)).rows as never);
      await db.exec?.("commit");
      return result;
    } catch (error) {
      await db.exec?.("rollback");
      throw error;
    }
  });
}
