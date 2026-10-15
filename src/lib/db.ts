import { Pool, type PoolClient } from 'pg';
import { databaseConnectionConfig } from './database-config';
const globalDb = globalThis as unknown as { agencyPool?: Pool };
const poolMax=Number(process.env.DB_POOL_MAX??(process.env.VERCEL==='1'?'2':'12'));
if(!Number.isInteger(poolMax)||poolMax<1||poolMax>50)throw new Error('DB_POOL_MAX deve ser um inteiro entre 1 e 50.');
const pool = globalDb.agencyPool ?? new Pool({ ...databaseConnectionConfig(process.env.DATABASE_URL), max: poolMax, connectionTimeoutMillis:10000, idleTimeoutMillis:30000 });
if (process.env.NODE_ENV !== 'production') globalDb.agencyPool = pool;
const configuredSchema=()=>process.env.DB_SCHEMA||(process.env.VERCEL==='1'?'autocampaign':undefined);
async function selectSchema(tx:PoolClient) {
  const schema=configuredSchema();
  if(!schema)return;
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('DB_SCHEMA inválido.');
  // Transaction-local state is safe with the Supabase Transaction pooler.
  // Exclude public so missing application tables never fall back to legacy data.
  await tx.query("SELECT set_config('search_path',$1,true)",[`${schema},pg_catalog`]);
  const result=await tx.query('SELECT current_schema() AS schema');
  if(result.rows[0].schema!==schema)throw new Error('Schema da aplicação não disponível.');
}
export const db={
  query:(text:string,values?:any[])=>configuredSchema()?transaction(tx=>tx.query(text,values)):pool.query(text,values),
  connect:()=>pool.connect(),
  end:()=>pool.end(),
  options:pool.options,
};
export async function transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try { await tx.query('BEGIN'); await selectSchema(tx); const result = await fn(tx); await tx.query('COMMIT'); return result; }
  catch (error) { await tx.query('ROLLBACK'); throw error; }
  finally { tx.release(); }
}
