import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/app/api/cron/jobs/route';
test('cron recusa segredo ausente, curto ou incorreto antes de acessar o banco',async()=>{
 const previous=process.env.CRON_SECRET;
 try{
  for(const secret of [undefined,'short','a'.repeat(32)]){
   if(secret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=secret;
   const response=await GET(new Request('http://localhost/api/cron/jobs',{headers:{authorization:'Bearer wrong'}}));
   assert.equal(response.status,401);
  }
 }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
