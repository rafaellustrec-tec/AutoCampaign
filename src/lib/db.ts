import { Pool, type PoolClient } from 'pg';
const globalDb = globalThis as unknown as { agencyPool?: Pool };
const poolMax=Number(process.env.DB_POOL_MAX??(process.env.VERCEL==='1'?'2':'12'));
if(!Number.isInteger(poolMax)||poolMax<1||poolMax>50)throw new Error('DB_POOL_MAX deve ser um inteiro entre 1 e 50.');
export const db = globalDb.agencyPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: poolMax, connectionTimeoutMillis:10000, idleTimeoutMillis:30000 });
if (process.env.NODE_ENV !== 'production') globalDb.agencyPool = db;
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try { await tx.query('BEGIN'); const result = await fn(tx); await tx.query('COMMIT'); return result; }
  catch (error) { await tx.query('ROLLBACK'); throw error; }
  finally { tx.release(); }
}
