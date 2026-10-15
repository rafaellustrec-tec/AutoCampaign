import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { execFileSync } from 'node:child_process';

test('PostgreSQL + worker nativo + Meta WhatsApp',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const root=new Pool({connectionString:process.env.TEST_DATABASE_URL,connectionTimeoutMillis:10000});const schema=`agency_test_${randomUUID().replaceAll('-','')}`;
 await root.query(`CREATE SCHEMA ${schema}`);const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
 process.env.ADS_PUBLISH_ENABLED='true';process.env.ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.META_API_VERSION='v25.0';
 delete process.env.N8N_WEBHOOK_URL;delete process.env.N8N_WEBHOOK_TOKEN;delete process.env.INTERNAL_API_TOKEN;
 const {db,transaction}=await import('../../src/lib/db');const {saveCampaign,campaignAction}=await import('../../src/lib/campaigns');
 const {claimJob,runJob,completeJob,heartbeatJob,validateJob}=await import('../../src/lib/job-runner');const {operation}=await import('../../src/lib/publishers');const {encrypt}=await import('../../src/lib/security');
 const originalFetch=globalThis.fetch;const calls:{path:string;body:URLSearchParams}[]=[];let mode='ok';let sequence=200;
 globalThis.fetch=async(input,init)=>{
  const u=new URL(String(input));assert.equal(u.hostname,'graph.facebook.com','nenhuma chamada a orquestrador ou outro serviço');
  if(init?.method!=='POST'){
   if(mode==='rate-limit')return Response.json({error:{message:'fixture'}},{status:429});
   if(mode==='auth')return Response.json({error:{message:'fixture'}},{status:401});
   return Response.json({id:'100',name:'Página teste',whatsapp_number:mode==='wrong-phone'?'5511999999999':'5571999999999'});
  }
  const body=new URLSearchParams(String(init.body));calls.push({path:u.pathname,body});
  if(mode==='lost-response')throw new TypeError('Resposta perdida após mutação');
  if(u.pathname.endsWith('/adimages'))return Response.json({images:{image:{hash:'image-hash'}}});
  if(['/campaigns','/adsets','/adcreatives','/ads'].some(s=>u.pathname.endsWith(s)))return Response.json({id:String(++sequence)});
  return Response.json({success:true});
 };
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const storage=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length});res.end(image);});
 await new Promise<void>(resolve=>storage.listen(0,'127.0.0.1',resolve));const port=(storage.address() as import('node:net').AddressInfo).port;
 Object.assign(process.env,{S3_ENDPOINT:`http://127.0.0.1:${port}`,S3_REGION:'us-east-1',S3_BUCKET:'fixture',S3_ACCESS_KEY_ID:'fixture',S3_SECRET_ACCESS_KEY:'fixture'});
 try{
  for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.query(await readFile(`migrations/${name}`,'utf8'));
  const makeUser=async(role:string)=>(await db.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$1) RETURNING id,name,email,role',[role,`${role}@example.com`,'unused'])).rows[0];
  const admin=await makeUser('admin'),operator=await makeUser('operator'),approver=await makeUser('approver');
  const client=(await db.query("INSERT INTO clients(name) VALUES('Client A') RETURNING id")).rows[0],other=(await db.query("INSERT INTO clients(name) VALUES('Client B') RETURNING id")).rows[0];
  for(const user of [operator,approver])await db.query('INSERT INTO client_members(client_id,user_id) VALUES($1,$2)',[client.id,user.id]);
  const connection=(await db.query("INSERT INTO connections(client_id,platform,credentials) VALUES($1,'meta',$2) RETURNING id",[client.id,encrypt(JSON.stringify({access_token:'fixture-token',expires_at:Date.now()+3600000}))])).rows[0];
  const account=(await db.query("INSERT INTO ad_accounts(client_id,connection_id,platform,external_id,name,currency,timezone) VALUES($1,$2,'meta','act_123','Meta A','BRL','America/Bahia') RETURNING *",[client.id,connection.id])).rows[0];
  const asset=(await db.query("INSERT INTO assets(client_id,name,storage_key,content_type,size,status) VALUES($1,'Criativo','fixture-image','image/png',$2,'ready') RETURNING id",[client.id,image.length])).rows[0];
  const briefing={name:'WhatsApp avaliação',offer:'Agende sua avaliação com a equipe',location:'Salvador',startDate:'2027-01-01',endDate:'2027-01-31',channels:[{platform:'meta',kind:'meta_whatsapp',accountId:account.id,dailyBudget:150,destination:'https://wa.me/5571999999999',whatsappNumber:'+55 71 99999-9999',pageId:'100',geoTargetId:'12345',metaCountry:'BR',assetIds:[asset.id]}]};
  const fresh=async()=>{const c=await saveCampaign(operator,client.id,briefing);await campaignAction(operator,c.id,'propose',1);await campaignAction(approver,c.id,'approve',1);await campaignAction(operator,c.id,'create',1);return c;};
  const jobState=async(id:string)=>(await db.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];
  await t.test('tabelas da aplicação usam RLS sem políticas públicas',async()=>{const rows=(await db.query("SELECT relrowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r'")).rows;assert.ok(rows.length>=19);assert.ok(rows.every(r=>r.relrowsecurity));});
  await t.test('SQL de instalação Supabase aplica migrações uma vez e protege tabelas',async()=>{
    execFileSync(process.execPath,['scripts/prepare-supabase.mjs']);const sql=await readFile('artifacts/supabase-bootstrap.sql','utf8');
    const setup=await root.connect();const target=`bootstrap_${randomUUID().replaceAll('-','')}`;
    try{await setup.query(`CREATE SCHEMA ${target}`);await setup.query(`SET search_path=${target}`);await setup.query(sql);await setup.query(sql);assert.equal((await setup.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'4');assert.equal((await setup.query("SELECT count(*) FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' AND NOT relrowsecurity")).rows[0].count,'0');}
    finally{await setup.query('ROLLBACK');await setup.query('SET search_path=public');await setup.query(`DROP SCHEMA IF EXISTS ${target} CASCADE`);setup.release();}
  });
  await t.test('isola clientes e materiais',async()=>{await assert.rejects(saveCampaign(operator,other.id,briefing),/Cliente/);await assert.rejects(saveCampaign(admin,other.id,briefing),/outro cliente/);const bad=structuredClone(briefing);bad.channels[0].assetIds=[randomUUID()];await assert.rejects(saveCampaign(operator,client.id,bad),/Material/);});
  await t.test('bloqueia formulários na API de criação',async()=>{const bad=structuredClone(briefing);bad.channels[0].kind='meta_form';await assert.rejects(saveCampaign(operator,client.id,bad));});
  let campaign=await saveCampaign(operator,client.id,briefing);
  await t.test('perfis e revisão por versão',async()=>{await assert.rejects(campaignAction(operator,campaign.id,'create',1));await campaignAction(operator,campaign.id,'propose',1);await assert.rejects(campaignAction(operator,campaign.id,'approve',1));await campaignAction(approver,campaign.id,'approve',1);campaign=await saveCampaign(operator,client.id,{...briefing,name:'Versão revisada'},campaign.id);await assert.rejects(campaignAction(operator,campaign.id,'create',1),/versão mudou/);await assert.rejects(campaignAction(operator,campaign.id,'create',2));await campaignAction(operator,campaign.id,'propose',2);await campaignAction(approver,campaign.id,'approve',2);});
  await t.test('enfileira sem variáveis do n8n e sem duplicar pedidos',async()=>{const results=await Promise.allSettled([campaignAction(operator,campaign.id,'create',2),campaignAction(operator,campaign.id,'create',2)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);});
  let job:any;
  await t.test('claim concorrente e lease válido',async()=>{const claims=await Promise.all([claimJob(),claimJob()]);assert.equal(claims.filter(Boolean).length,1);job=claims.find(Boolean);await assert.rejects(transaction(tx=>validateJob(tx,job.id,randomUUID())),/expirada/);await heartbeatJob(job.id,job.lease_token);await assert.rejects(completeJob(job.id,job.lease_token),/incompleta/);});
  await t.test('worker executa conector Meta com API simulada, sem webhook',async()=>{const results=await Promise.all([runJob(job),runJob(job)]);assert.equal(results.filter(r=>r.status==='succeeded').length,1);assert.equal((await jobState(job.id)).status,'succeeded');assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[campaign.id])).rows[0].status,'paused');assert.equal(calls.filter(c=>c.path.endsWith('/campaigns')).length,1);for(const call of calls.filter(c=>['/campaigns','/adsets','/ads'].some(s=>c.path.endsWith(s))))assert.equal(call.body.get('status'),'PAUSED');const set=calls.find(c=>c.path.endsWith('/adsets'))!;assert.equal(set.body.get('destination_type'),'WHATSAPP');assert.equal(set.body.get('optimization_goal'),'CONVERSATIONS');const creative=calls.find(c=>c.path.endsWith('/adcreatives'))!;assert.equal(JSON.parse(creative.body.get('object_story_spec')!).link_data.call_to_action.value.whatsapp_number,'5571999999999');});
  await t.test('apenas aprovador autoriza ativação; worker ativa e conclui',async()=>{await assert.rejects(campaignAction(operator,campaign.id,'activate',2));await campaignAction(approver,campaign.id,'activate',2);job=await claimJob();assert.equal((await runJob(job)).status,'succeeded');assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[campaign.id])).rows[0].status,'active');});
  await t.test('número não vinculado falha antes de qualquer mutação',async()=>{await fresh();job=await claimJob();const before=calls.length;mode='wrong-phone';assert.equal((await runJob(job)).status,'failed');assert.equal((await jobState(job.id)).error,'INVALID_CONFIGURATION');assert.equal(calls.length,before);mode='ok';});
  await t.test('quota em leitura agenda retentativa segura',async()=>{await fresh();job=await claimJob();mode='rate-limit';assert.equal((await runJob(job)).status,'queued');assert.equal((await jobState(job.id)).error,'RATE_LIMIT');await db.query("UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",[job.id]);mode='ok';job=await claimJob();assert.equal(job.attempts,2);assert.equal((await runJob(job)).status,'succeeded');});
  await t.test('autorização expirada exige reconexão',async()=>{await fresh();job=await claimJob();mode='auth';assert.equal((await runJob(job)).status,'failed');assert.equal((await jobState(job.id)).error,'AUTH_EXPIRED');assert.equal((await db.query('SELECT status FROM connections WHERE id=$1',[connection.id])).rows[0].status,'reconnect');await db.query("UPDATE connections SET status='connected' WHERE id=$1",[connection.id]);mode='ok';});
  await t.test('resposta perdida bloqueia repetição da mutação',async()=>{await fresh();job=await claimJob();mode='lost-response';assert.equal((await runJob(job)).status,'failed');assert.equal((await jobState(job.id)).error,'AMBIGUOUS_RESULT');const before=calls.length;await assert.rejects(operation(job,{...account,credentials:'unused'},'meta-campaign',async()=>{throw new Error('Nunca deve executar');}));assert.equal(calls.length,before);mode='ok';});
  await t.test('lease expirado não recria tarefas automaticamente',async()=>{await fresh();job=await claimJob();await db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);assert.equal(await claimJob(),null);assert.equal((await jobState(job.id)).status,'failed');assert.equal((await runJob(job)).status,'lost_lease');});
  await t.test('workflow reivindica somente seu job e não usa lock de sessão',async()=>{const {workflowAttempt}=await import('../../src/lib/workflow-runner');const a=await fresh(),b=await fresh();const first=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1',[a.id])).rows[0];const second=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1',[b.id])).rows[0];const before=calls.filter(c=>c.path.endsWith('/campaigns')).length;await Promise.all([workflowAttempt(second.id),workflowAttempt(second.id)]);assert.equal((await jobState(second.id)).status,'succeeded');assert.equal((await jobState(first.id)).status,'queued');assert.equal(calls.filter(c=>c.path.endsWith('/campaigns')).length,before+1);await workflowAttempt(first.id);assert.equal((await jobState(first.id)).status,'succeeded');const repeat=await workflowAttempt(second.id);assert.equal(repeat.status,'succeeded');assert.equal(repeat.waitMs,0);});
  await t.test('workflow conserva backoff, bloqueia ambiguidade e respeita flag',async()=>{const {workflowAttempt}=await import('../../src/lib/workflow-runner');const c=await fresh();const id=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1',[c.id])).rows[0].id;process.env.ADS_PUBLISH_ENABLED='false';assert.equal((await workflowAttempt(id)).status,'disabled');assert.equal((await jobState(id)).attempts,0);process.env.ADS_PUBLISH_ENABLED='true';mode='rate-limit';const result=await workflowAttempt(id);assert.equal(result.status,'queued');assert.ok(result.waitMs>1000);assert.equal((await jobState(id)).attempts,1);await db.query('UPDATE jobs SET available_at=now() WHERE id=$1',[id]);mode='lost-response';assert.equal((await workflowAttempt(id)).status,'failed');const before=calls.length;mode='ok';assert.equal((await workflowAttempt(id)).status,'failed');assert.equal(calls.length,before);});
 }finally{globalThis.fetch=originalFetch;await new Promise<void>(resolve=>storage.close(()=>resolve()));await db.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
});

