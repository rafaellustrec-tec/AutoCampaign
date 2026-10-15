import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const port=Number(process.env.SMOKE_PORT??3218);
let logs='';
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{stdio:['ignore','pipe','pipe']});
for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{logs=(logs+data.toString()).slice(-8000);});
try {
 const base=`http://127.0.0.1:${port}`;
 let ready=false;
 for(let n=0;n<45;n++){
  if(server.exitCode!==null)throw new Error(`Servidor encerrou: ${logs}`);
  try{const r=await fetch(`${base}/api/me`,{signal:AbortSignal.timeout(1000)});if(r.status===401){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(ready,true,`Backend não iniciou: ${logs}`);
 for(const path of ['/','/demo']){const r=await fetch(`${base}${path}`,{signal:AbortSignal.timeout(10000)});assert.equal(r.status,200,path);assert.match(await r.text(),/Órbita/);}
 const api=await fetch(`${base}/api/me`);assert.equal(api.status,401);assert.match(api.headers.get('content-type'),/application\/json/);
 console.log('Smoke produção: login e demo 200; backend /api/me 401 JSON.');
}finally{server.kill('SIGTERM');}
