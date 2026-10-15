import { readFile,readdir,mkdir,writeFile } from 'node:fs/promises';
const names=(await readdir('migrations')).filter(n=>/^\d+_[a-z_]+\.sql$/.test(n)).sort();
const schema=process.env.DB_SCHEMA;
if(schema&&!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('DB_SCHEMA inválido.');
let sql="-- AutoCampaign installation. No credentials included.\nBEGIN;\n";
if(schema)sql+=`CREATE SCHEMA IF NOT EXISTS "${schema}";\nREVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC;\nSET LOCAL search_path="${schema}",pg_catalog;\n`;
sql+="SELECT pg_advisory_xact_lock(72401823);\nCREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());\nALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;\n";
for(const name of names){
 const migration=await readFile(`migrations/${name}`,'utf8');
 if(migration.includes('$apply_migration$'))throw Error('Unexpected SQL delimiter');
 sql+=`\nDO $apply_migration$ BEGIN\nIF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='${name}') THEN\n${migration}\nINSERT INTO schema_migrations(name) VALUES('${name}');\nEND IF;\nEND $apply_migration$;\n`;
}
sql+='COMMIT;\n';
await mkdir('artifacts',{recursive:true});
const output=schema?`artifacts/supabase-${schema}-bootstrap.sql`:'artifacts/supabase-bootstrap.sql';
await writeFile(output,sql);
console.log(`Prepared ${names.length} migrations in ${output}. No database was changed.`);
