import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes,randomUUID } from 'node:crypto';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve,sep } from 'node:path';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
const listener=createServer();
await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=(listener.address() as import('node:net').AddressInfo).port;
await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
const password=randomBytes(24).toString('hex');
const artifactRoot=resolve('artifacts');
const databaseDir=resolve(artifactRoot,`postgres-${randomUUID()}`);
if(!databaseDir.startsWith(artifactRoot+sep))throw new Error('Diretório temporário fora de artifacts.');
const server=new EmbeddedPostgres({databaseDir,user:'postgres',password,port,persistent:true});
try{
 await server.initialise();await server.start();await server.createDatabase('agency_tests');
 const exitCode=await new Promise<number|null>((resolveExit,reject)=>{const child=spawn(process.execPath,['--import','tsx','--test','tests/integration/native-worker.test.ts'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/agency_tests`}});child.on('error',reject);child.on('exit',resolveExit);});
 process.exitCode=exitCode??1;
}finally{
 if(process.platform==='win32') {
  // pg_ctl performs a bounded, graceful shutdown; the package's Windows
  // taskkill wrapper can wait forever when its child has already exited.
  await promisify(execFile)(resolve('node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),['-D',databaseDir,'stop','-m','fast','-w','-t','15']);
 } else await server.stop();
 await rm(databaseDir,{recursive:true,force:true,maxRetries:15,retryDelay:150});
}
