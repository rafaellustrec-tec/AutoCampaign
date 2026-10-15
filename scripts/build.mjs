import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const diagnostics = fileURLToPath(new URL('./build-memory.cjs', import.meta.url)).replaceAll('\\','/');
const heap = process.env.BUILD_HEAP_MB ?? '512';
if (!/^\d+$/.test(heap) || Number(heap)<256 || Number(heap)>4096) throw new Error('BUILD_HEAP_MB deve estar entre 256 e 4096.');
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: '1',
  RAYON_NUM_THREADS: '1',
  UV_THREADPOOL_SIZE: '1',
  NODE_OPTIONS: `${process.env.NODE_OPTIONS??''} --max-old-space-size=${heap} --require "${diagnostics}"`.trim(),
};
delete env.AGENCY_BUILD_TYPECHECKED;
for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
  try { console.error(`[build] container memory limit: ${(await readFile(path,'utf8')).trim()} bytes`); break; } catch {}
}
console.error(`[build] Node ${process.version}; webpack; one worker; heap cap ${heap} MiB per Node process`);
async function run(label, script, args, extra={}) {
  console.error(`[build] ${label} started`);
  const start=Date.now();
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,...args],{cwd:root,env:{...env,...extra},stdio:'inherit'});
    const stop=()=>child.kill('SIGTERM');
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    child.once('error',reject);
    child.once('exit',(code,signal)=>{
      process.off('SIGINT',stop);process.off('SIGTERM',stop);
      if(code===0)resolve();else reject(new Error(`${label} failed: exit=${code}, signal=${signal??'none'}`));
    });
  });
  console.error(`[build] ${label} passed in ${((Date.now()-start)/1000).toFixed(1)}s`);
}
try {
  await run('TypeScript',require.resolve('typescript/bin/tsc'),['--noEmit','--incremental','false']);
  await run('Next.js',require.resolve('next/dist/bin/next'),['build','--webpack'],{AGENCY_BUILD_TYPECHECKED:'1'});
} catch(error) {console.error(`[build] ${error.message}`);process.exitCode=1;}
