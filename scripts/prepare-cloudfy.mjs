import { cp, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'artifacts', `cloudfy-${randomUUID()}`);
const entries = [
  'package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts',
  'next.config.ts', 'Dockerfile', '.dockerignore',
  'src', 'migrations', 'scripts/migrate.ts', 'scripts/create-user.ts', 'scripts/worker.ts',
  'scripts/build.mjs', 'scripts/build-memory.cjs',
];

async function check(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error('O pacote não aceita links simbólicos.');
  if (stat.isDirectory()) {
    for (const entry of await readdir(path)) {
      if (/^\.env(?:\.|$)/i.test(entry) || ['.cloudfy.json', '.git', 'node_modules', '.next', 'artifacts'].includes(entry)) {
        throw new Error(`Arquivo ou diretório não permitido no pacote: ${entry}`);
      }
      await check(join(path, entry));
    }
  }
}

for (const entry of entries) await check(resolve(root, entry));
await mkdir(destination, { recursive: true });
for (const entry of entries) {
  const target = resolve(destination, entry);
  await mkdir(resolve(target, '..'), { recursive: true });
  await cp(resolve(root, entry), target, { recursive: true, errorOnExist: true, force: false });
}
await check(destination);
if (process.argv.includes('--slim')) {
  const manifestPath = join(destination, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const name of ['@playwright/test', 'embedded-postgres']) delete manifest.devDependencies[name];
  for (const name of ['test', 'test:integration', 'test:postgres']) delete manifest.scripts[name];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2)+'\n');
  console.log('Perfil slim: ferramentas de navegador/PostgreSQL temporário removidas apenas do pacote de deploy.');
  console.log('Antes do envio, atualizar o lockfile nesta pasta com npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund.');
}
console.log(`Pasta de envio preparada: ${destination}`);
console.log('Nenhum deploy foi realizado. Execute a CLI somente nesta pasta após confirmar o suporte ao servidor Next.js.');
