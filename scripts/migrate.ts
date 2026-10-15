import { readFile, readdir } from 'node:fs/promises';
import { db,transaction } from '../src/lib/db';
try {
  await transaction(async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(72401823)");
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()) {
      if((await tx.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount) continue;
      await tx.query(await readFile(`migrations/${name}`,'utf8'));
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
      console.log(`Aplicada: ${name}`);
    }
  });
} finally { await db.end(); }
