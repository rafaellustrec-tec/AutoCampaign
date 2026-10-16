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
 process.env.ADS_PUBLISH_ENABLED='true';process.env.ADS_ACTIVATION_ENABLED='true';process.env.ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.META_API_VERSION='v25.0';
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
  await t.test('estratégias: isolamento, conflito, preparação atômica nos dois canais e bloqueios',async()=>{
   const {saveStrategy,getStrategy,prepareStrategy}=await import('../../src/lib/strategies');
   const {emptyStrategy}=await import('../../src/lib/strategy-model');
   const gc=(await db.query("INSERT INTO connections(client_id,platform,credentials) VALUES($1,'google',$2) RETURNING id",[client.id,encrypt(JSON.stringify({access_token:'fixture-google',expires_at:Date.now()+3600000}))])).rows[0];
   const ga=(await db.query("INSERT INTO ad_accounts(client_id,connection_id,platform,external_id,name,currency,timezone) VALUES($1,$2,'google','7775553331','Google A','BRL','America/Bahia') RETURNING id",[client.id,gc.id])).rows[0];
   const d=emptyStrategy(),id=randomUUID();const one=await saveStrategy(operator,client.id,id,{expectedVersion:0,step:0,data:d});assert.equal(one.version,1);
   await assert.rejects(getStrategy(operator,other.id,id));await assert.rejects(saveStrategy(approver,client.id,randomUUID(),{expectedVersion:0,step:0,data:d}));
   d.name='Estratégia completa';Object.assign(d,{totalBudget:3000,startDate:'2027-01-01',endDate:'2027-01-30',location:'Salvador'});Object.assign(d.fronts[0].meta,{accountId:account.id,pageId:'100',phone:'5571999999999',geoId:'12345',creatives:[{id:randomUUID(),assetId:asset.id,title:'Agende uma consulta',text:'Converse com nossa equipe.'}]});Object.assign(d.fronts[0].google,{enabled:true,accountId:ga.id,landingPage:'https://example.com',conversionId:'123',geoId:'1001593',keywords:'consulta particular',negatives:'grátis',headlines:['Agende uma consulta','Conheça nossa equipe','Atendimento em Salvador'],descriptions:['Converse com nossa equipe sobre consultas.','Atendimento particular em Salvador.']});
   const two=await saveStrategy(operator,client.id,id,{expectedVersion:1,step:4,data:d});assert.equal(two.version,2);
   await assert.rejects(saveStrategy(operator,client.id,id,{expectedVersion:1,step:3,data:d}),/Outra alteração/);
   await assert.rejects(prepareStrategy(operator,client.id,id,1),/mudou/);
   const before=calls.length;process.env.ADS_PUBLISH_ENABLED='false';process.env.ADS_ACTIVATION_ENABLED='false';
   try{const result=await prepareStrategy(operator,client.id,id,2);assert.equal(result.campaigns.length,2);const repeat=await prepareStrategy(operator,client.id,id,2);assert.equal(repeat.campaigns.length,2);assert.equal(calls.length,before);
    for(const c of result.campaigns){assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[c.id])).rows[0].status,'proposed');assert.equal((await db.query('SELECT count(*) FROM jobs WHERE campaign_id=$1',[c.id])).rows[0].count,'0');await assert.rejects(campaignAction(admin,c.id,'create',1));}
    await assert.rejects(saveStrategy(operator,client.id,id,{expectedVersion:2,step:4,data:d}),/Duplique/);
   }finally{process.env.ADS_PUBLISH_ENABLED='true';process.env.ADS_ACTIVATION_ENABLED='true';}
  });
  const briefing={name:'WhatsApp avaliação',offer:'Agende sua avaliação com a equipe',location:'Salvador',startDate:'2027-01-01',endDate:'2027-01-31',channels:[{platform:'meta',kind:'meta_whatsapp',accountId:account.id,dailyBudget:150,destination:'https://wa.me/5571999999999',whatsappNumber:'+55 71 99999-9999',pageId:'100',geoTargetId:'12345',metaCountry:'BR',assetIds:[asset.id]}]};
  const fresh=async()=>{const c=await saveCampaign(operator,client.id,briefing);await campaignAction(operator,c.id,'propose',1);await campaignAction(approver,c.id,'approve',1);await campaignAction(operator,c.id,'create',1);return c;};
  const jobState=async(id:string)=>(await db.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];
  await t.test('schema explícito fica restrito à transação e não recai em public',async()=>{const previous=process.env.DB_SCHEMA;try{process.env.DB_SCHEMA=schema;assert.equal((await db.query('SELECT current_schema() AS schema')).rows[0].schema,schema);assert.equal(await transaction(async tx=>(await tx.query('SELECT current_schema() AS schema')).rows[0].schema),schema);process.env.DB_SCHEMA='schema_inexistente_autocampaign';await assert.rejects(db.query('SELECT * FROM jobs'),/não disponível/);process.env.DB_SCHEMA='public;drop';await assert.rejects(db.query('SELECT 1'),/DB_SCHEMA inválido/);}finally{if(previous===undefined)delete process.env.DB_SCHEMA;else process.env.DB_SCHEMA=previous;}assert.equal((await db.query('SELECT current_schema() AS schema')).rows[0].schema,schema);});
  await t.test('tabelas da aplicação usam RLS sem políticas públicas',async()=>{const rows=(await db.query("SELECT relrowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r'")).rows;assert.ok(rows.length>=19);assert.ok(rows.every(r=>r.relrowsecurity));});
  await t.test('SQL de instalação Supabase aplica migrações uma vez e protege tabelas',async()=>{
    execFileSync(process.execPath,['scripts/prepare-supabase.mjs']);const sql=await readFile('artifacts/supabase-bootstrap.sql','utf8');
    const setup=await root.connect();const target=`bootstrap_${randomUUID().replaceAll('-','')}`;
    try{await setup.query(`CREATE SCHEMA ${target}`);await setup.query(`SET search_path=${target}`);await setup.query(sql);await setup.query(sql);assert.equal((await setup.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'6');assert.equal((await setup.query("SELECT count(*) FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' AND NOT relrowsecurity")).rows[0].count,'0');}
    finally{await setup.query('ROLLBACK');await setup.query('SET search_path=public');await setup.query(`DROP SCHEMA IF EXISTS ${target} CASCADE`);setup.release();}
  });
  await t.test('isola clientes e materiais',async()=>{await assert.rejects(saveCampaign(operator,other.id,briefing),/Cliente/);await assert.rejects(saveCampaign(admin,other.id,briefing),/outro cliente/);const bad=structuredClone(briefing);bad.channels[0].assetIds=[randomUUID()];await assert.rejects(saveCampaign(operator,client.id,bad),/Material/);});
  await t.test('bloqueia formulários na API de criação',async()=>{const bad=structuredClone(briefing);bad.channels[0].kind='meta_form';await assert.rejects(saveCampaign(operator,client.id,bad));});
  let campaign=await saveCampaign(operator,client.id,briefing);
  await t.test('perfis e revisão por versão',async()=>{await assert.rejects(campaignAction(operator,campaign.id,'create',1));await campaignAction(operator,campaign.id,'propose',1);await assert.rejects(campaignAction(operator,campaign.id,'approve',1));await campaignAction(approver,campaign.id,'approve',1);campaign=await saveCampaign(operator,client.id,{...briefing,name:'Versão revisada'},campaign.id);await assert.rejects(campaignAction(operator,campaign.id,'create',1),/versão mudou/);await assert.rejects(campaignAction(operator,campaign.id,'create',2));await campaignAction(operator,campaign.id,'propose',2);await campaignAction(approver,campaign.id,'approve',2);});
  await t.test('liberação de piloto não enfileira outra campanha',async()=>{process.env.ADS_PUBLISH_CAMPAIGN_IDS=randomUUID();try{await assert.rejects(campaignAction(operator,campaign.id,'create',2),/restrita ao teste/);assert.equal((await db.query('SELECT count(*) FROM jobs WHERE campaign_id=$1',[campaign.id])).rows[0].count,'0');}finally{delete process.env.ADS_PUBLISH_CAMPAIGN_IDS;}});
  await t.test('WhatsApp omitido exige conferência administrativa recente e exata; divergência sempre falha',async()=>{
   const {verifyPageWhatsApp}=await import('../../src/lib/meta-whatsapp-verification');const job={campaign_id:campaign.id,client_id:client.id,version:2};const verify=(number='5571999999999',page='100',reported?:string)=>verifyPageWhatsApp(job,account.id,page,number,reported);process.env.ADS_PUBLISH_CAMPAIGN_IDS=campaign.id;
   try{await assert.rejects(verify(),/não foi retornado/);const detail={version:2,accountId:account.id,pageId:'100',number:'5571999999999',source:'facebook_page_linked_whatsapp_settings',proofSha256:'a'.repeat(64)};const row=(await db.query("INSERT INTO audit_log(user_id,client_id,action,entity_id,detail) VALUES($1,$2,'meta.whatsapp_verified',$3,$4) RETURNING id",[operator.id,client.id,campaign.id,JSON.stringify(detail)])).rows[0];await assert.rejects(verify());await db.query('UPDATE audit_log SET user_id=$2 WHERE id=$1',[row.id,admin.id]);await verify();await assert.rejects(verify('5511999999999'));await assert.rejects(verify('5571999999999','200'));await assert.rejects(verify('5571999999999','100','5511999999999'),/não corresponde/);await assert.rejects(verifyPageWhatsApp({...job,version:3},account.id,'100','5571999999999',undefined));await db.query("UPDATE audit_log SET created_at=now()-interval '5 hours' WHERE id=$1",[row.id]);await assert.rejects(verify());
   }finally{delete process.env.ADS_PUBLISH_CAMPAIGN_IDS;}
  });
  await t.test('enfileira sem variáveis do n8n e sem duplicar pedidos',async()=>{const results=await Promise.allSettled([campaignAction(operator,campaign.id,'create',2),campaignAction(operator,campaign.id,'create',2)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);});
  let job:any;
  await t.test('claim concorrente e lease válido',async()=>{const claims=await Promise.all([claimJob(),claimJob()]);assert.equal(claims.filter(Boolean).length,1);job=claims.find(Boolean);await assert.rejects(transaction(tx=>validateJob(tx,job.id,randomUUID())),/expirada/);await heartbeatJob(job.id,job.lease_token);await assert.rejects(completeJob(job.id,job.lease_token),/incompleta/);});
  await t.test('worker executa conector Meta com API simulada, sem webhook',async()=>{const results=await Promise.all([runJob(job),runJob(job)]);assert.equal(results.filter(r=>r.status==='succeeded').length,1);assert.equal((await jobState(job.id)).status,'succeeded');assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[campaign.id])).rows[0].status,'paused');assert.equal(calls.filter(c=>c.path.endsWith('/campaigns')).length,1);for(const call of calls.filter(c=>['/campaigns','/adsets','/ads'].some(s=>c.path.endsWith(s))))assert.equal(call.body.get('status'),'PAUSED');const set=calls.find(c=>c.path.endsWith('/adsets'))!;assert.equal(set.body.get('destination_type'),'WHATSAPP');assert.equal(set.body.get('optimization_goal'),'CONVERSATIONS');const creative=calls.find(c=>c.path.endsWith('/adcreatives'))!;assert.equal(JSON.parse(creative.body.get('object_story_spec')!).link_data.call_to_action.value.whatsapp_number,'5571999999999');});
  await t.test('bloqueio independente impede aprovação e worker antes de qualquer chamada Meta',async()=>{
    process.env.ADS_ACTIVATION_ENABLED='false';const before=calls.length;
    await assert.rejects(campaignAction(admin,campaign.id,'activate',2),/Ativação bloqueada/);
    assert.equal((await db.query("SELECT count(*) FROM approvals WHERE campaign_id=$1 AND kind='activate'",[campaign.id])).rows[0].count,'0');
    assert.equal((await db.query("SELECT count(*) FROM jobs WHERE campaign_id=$1 AND kind='activate'",[campaign.id])).rows[0].count,'0');
    process.env.ADS_ACTIVATION_ENABLED='true';await campaignAction(approver,campaign.id,'activate',2);job=await claimJob();
    process.env.ADS_ACTIVATION_ENABLED='false';
    assert.equal((await runJob(job)).status,'failed');
    assert.equal((await jobState(job.id)).status,'failed');
    assert.equal(calls.length,before);
    process.env.ADS_ACTIVATION_ENABLED='true';
    // Simulate the existing explicit retry action after the server gate is enabled.
    await db.query("UPDATE jobs SET status='queued',available_at=now(),attempts=0,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1",[job.id]);
    await db.query("UPDATE campaigns SET status='activating' WHERE id=$1",[campaign.id]);
    job=await claimJob(job.id);
  });
  await t.test('somente com desbloqueio explícito o worker ativa a versão aprovada',async()=>{assert.equal((await runJob(job)).status,'succeeded');assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[campaign.id])).rows[0].status,'active');});
  await t.test('número não vinculado falha antes de qualquer mutação',async()=>{await fresh();job=await claimJob();const before=calls.length;mode='wrong-phone';assert.equal((await runJob(job)).status,'failed');assert.equal((await jobState(job.id)).error,'INVALID_CONFIGURATION');assert.equal(calls.length,before);mode='ok';});
  await t.test('quota em leitura agenda retentativa segura',async()=>{await fresh();job=await claimJob();mode='rate-limit';assert.equal((await runJob(job)).status,'queued');assert.equal((await jobState(job.id)).error,'RATE_LIMIT');await db.query("UPDATE jobs SET available_at=now()-interval '1 second' WHERE id=$1",[job.id]);mode='ok';job=await claimJob();assert.equal(job.attempts,2);assert.equal((await runJob(job)).status,'succeeded');});
  await t.test('autorização expirada exige reconexão',async()=>{await fresh();job=await claimJob();mode='auth';assert.equal((await runJob(job)).status,'failed');assert.equal((await jobState(job.id)).error,'AUTH_EXPIRED');assert.equal((await db.query('SELECT status FROM connections WHERE id=$1',[connection.id])).rows[0].status,'reconnect');await db.query("UPDATE connections SET status='connected' WHERE id=$1",[connection.id]);mode='ok';});
  await t.test('resposta perdida bloqueia repetição da mutação',async()=>{await fresh();job=await claimJob();mode='lost-response';assert.equal((await runJob(job)).status,'failed');assert.equal((await jobState(job.id)).error,'AMBIGUOUS_RESULT');const before=calls.length;await assert.rejects(operation(job,{...account,credentials:'unused'},'meta-campaign',async()=>{throw new Error('Nunca deve executar');}));assert.equal(calls.length,before);mode='ok';});
  await t.test('lease expirado não recria tarefas automaticamente',async()=>{await fresh();job=await claimJob();await db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);assert.equal(await claimJob(),null);assert.equal((await jobState(job.id)).status,'failed');assert.equal((await runJob(job)).status,'lost_lease');});
  await t.test('workflow reivindica somente seu job e não usa lock de sessão',async()=>{const {workflowAttempt}=await import('../../src/lib/workflow-runner');const a=await fresh(),b=await fresh();const first=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1',[a.id])).rows[0];const second=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1',[b.id])).rows[0];const before=calls.filter(c=>c.path.endsWith('/campaigns')).length;await Promise.all([workflowAttempt(second.id),workflowAttempt(second.id)]);assert.equal((await jobState(second.id)).status,'succeeded');assert.equal((await jobState(first.id)).status,'queued');assert.equal(calls.filter(c=>c.path.endsWith('/campaigns')).length,before+1);await workflowAttempt(first.id);assert.equal((await jobState(first.id)).status,'succeeded');const repeat=await workflowAttempt(second.id);assert.equal(repeat.status,'succeeded');assert.equal(repeat.waitMs,0);});
  await t.test('workflow conserva backoff, bloqueia ambiguidade e respeita flag',async()=>{const {workflowAttempt}=await import('../../src/lib/workflow-runner');const c=await fresh();const id=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1',[c.id])).rows[0].id;process.env.ADS_PUBLISH_ENABLED='false';assert.equal((await workflowAttempt(id)).status,'disabled');assert.equal((await jobState(id)).attempts,0);process.env.ADS_PUBLISH_ENABLED='true';mode='rate-limit';const result=await workflowAttempt(id);assert.equal(result.status,'queued');assert.ok(result.waitMs>1000);assert.equal((await jobState(id)).attempts,1);await db.query('UPDATE jobs SET available_at=now() WHERE id=$1',[id]);mode='lost-response';assert.equal((await workflowAttempt(id)).status,'failed');const before=calls.length;mode='ok';assert.equal((await workflowAttempt(id)).status,'failed');assert.equal(calls.length,before);});
  await t.test('variações Meta reutilizam upload e criam anúncios distintos pausados',async()=>{
   mode='ok';const input=structuredClone(briefing) as any;input.name='Variações de criativo';input.channels[0].creativeVariants=[{id:randomUUID(),assetId:asset.id,title:'Primeira mensagem',text:'Agende uma consulta com nossa equipe.'},{id:randomUUID(),assetId:asset.id,title:'Segunda mensagem',text:'Converse com a equipe sobre atendimento.'}];const c=await saveCampaign(operator,client.id,input);await campaignAction(operator,c.id,'propose',1);await campaignAction(approver,c.id,'approve',1);await campaignAction(operator,c.id,'create',1);const jobId=(await db.query("SELECT id FROM jobs WHERE campaign_id=$1 AND kind='create'",[c.id])).rows[0].id,before=calls.length;const job=await claimJob(jobId);assert.ok(job);assert.equal((await runJob(job)).status,'succeeded');const actual=calls.slice(before);assert.equal(actual.filter(c=>c.path.endsWith('/adimages')).length,1);assert.equal(actual.filter(c=>c.path.endsWith('/ads')).length,2);assert.deepEqual(actual.filter(c=>c.path.endsWith('/adcreatives')).map(c=>JSON.parse(c.body.get('object_story_spec')!).link_data.name),['Primeira mensagem','Segunda mensagem']);assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[c.id])).rows[0].status,'paused');
  });
  await t.test('lista global importa sem duplicar, preserva vínculos, protege lotes e recupera falhas',async()=>{
    const {synchronizeAccounts,savedAccounts,assignAccounts}=await import('../../src/lib/account-registry');
    const {AppError}=await import('../../src/lib/domain');
    const global=(await db.query("INSERT INTO connections(client_id,platform,credentials) VALUES(NULL,'meta',$1) RETURNING id",[encrypt(JSON.stringify({access_token:'fixture-global',expires_at:Date.now()+3600000}))])).rows[0];
    const snapshot=Array.from({length:120},(_,i)=>({externalId:`act_${9000000000+i}`,name:`Conta ${i}`,currency:'BRL',timezone:'America/Bahia'}));
    snapshot.push({externalId:'act_123',name:'Conta existente',currency:'BRL',timezone:'America/Bahia'});
    let calls=0;const discover=async()=>{calls++;return [...snapshot,snapshot[0]];};
    await assert.rejects(synchronizeAccounts(operator,global.id,discover));await assert.rejects(savedAccounts(operator));assert.equal(calls,0);
    assert.equal((await synchronizeAccounts(admin,global.id,discover)).count,121);
    const first=await savedAccounts(admin);assert.equal(first.filter((a:any)=>snapshot.some(s=>s.externalId===a.external_id)).length,121);
    assert.ok(first.every((a:any)=>!('credentials' in a)));assert.equal(first.find((a:any)=>a.external_id==='act_123').client_id,client.id);
    assert.equal((await synchronizeAccounts(admin,global.id,discover)).count,121);assert.equal((await savedAccounts(admin)).length,first.length);
    const a=first.find((row:any)=>row.external_id===snapshot[0].externalId),b=first.find((row:any)=>row.external_id===snapshot[1].externalId),c=first.find((row:any)=>row.external_id===snapshot[2].externalId);
    await assert.rejects(assignAccounts(operator,[{accountId:a.id,clientId:client.id}]));
    const batch=[{accountId:a.id,clientId:client.id},{accountId:b.id,clientId:other.id}];assert.equal((await assignAccounts(admin,batch)).linked,2);assert.equal((await assignAccounts(admin,batch)).linked,0);
    await assert.rejects(assignAccounts(admin,[{accountId:c.id,clientId:client.id},{accountId:a.id,clientId:other.id}]),/outro cliente/);
    assert.equal((await db.query('SELECT client_id FROM ad_accounts WHERE id=$1',[c.id])).rows[0].client_id,null);
    await assert.rejects(assignAccounts(admin,[batch[0],batch[0]]));
    await assert.rejects(assignAccounts(admin,[{accountId:c.id,clientId:randomUUID()}]),/cliente/);
    await assert.rejects(synchronizeAccounts(admin,global.id,async()=>{throw new AppError(429,'quota');}));
    assert.equal((await db.query('SELECT import_error FROM connections WHERE id=$1',[global.id])).rows[0].import_error,'RATE_LIMIT');
    assert.equal((await savedAccounts(admin)).filter((r:any)=>r.available).length,first.length);
    let release!:()=>void;let ready!:()=>void;const readyPromise=new Promise<void>(resolve=>{ready=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});
    const running=synchronizeAccounts(admin,global.id,async()=>{ready();await held;return snapshot;});await readyPromise;
    await assert.rejects(synchronizeAccounts(admin,global.id,discover),/andamento/);release();await running;
    await synchronizeAccounts(admin,global.id,async()=>snapshot.filter(row=>row.externalId!==a.external_id));
    const missing=(await db.query('SELECT client_id,available FROM ad_accounts WHERE id=$1',[a.id])).rows[0];assert.equal(missing.client_id,client.id);assert.equal(missing.available,false);
    await assert.rejects(assignAccounts(admin,[{accountId:a.id,clientId:client.id}]),/indisponível/);
    const reauth=(await db.query("INSERT INTO connections(client_id,platform,credentials) VALUES(NULL,'meta','fixture-encrypted-unused') RETURNING id")).rows[0];
    await synchronizeAccounts(admin,reauth.id,async()=>snapshot);
    const restored=(await db.query('SELECT id,client_id,connection_id,available FROM ad_accounts WHERE id=$1',[a.id])).rows[0];assert.equal(restored.client_id,client.id);assert.equal(restored.connection_id,reauth.id);assert.equal(restored.available,true);
    assert.equal((await savedAccounts(admin)).length,first.length);
  });
  await t.test('Google OAuth global importa automaticamente, renova token e exige reconexão após revogação',async()=>{
    const {oauthStart,oauthCallback,accessToken,listRemoteAccounts}=await import('../../src/lib/oauth');
    const savedFetch=globalThis.fetch;const envKeys=['APP_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_ADS_DEVELOPER_TOKEN','GOOGLE_ADS_API_VERSION','GOOGLE_ADS_LOGIN_CUSTOMER_ID'];
    const savedEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));let revoked=false;let tokenCalls=0;let refreshCalls=0;
    Object.assign(process.env,{APP_URL:'https://example.com',GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_ADS_API_VERSION:'v25'});delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    globalThis.fetch=async(input,init)=>{
      const url=new URL(String(input));
      if(url.hostname==='oauth2.googleapis.com'){
        const form=new URLSearchParams(String(init?.body));tokenCalls++;
        assert.equal(form.get('client_secret'),'fixture-secret');
        if(form.get('grant_type')==='refresh_token'){refreshCalls++;assert.equal(form.get('refresh_token'),'fixture-refresh');return revoked?Response.json({error:'invalid_grant'},{status:400}):Response.json({access_token:'fixture-renewed',expires_in:3600});}
        assert.equal(form.get('redirect_uri'),'https://example.com/api/oauth/google/callback');
        return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:1});
      }
      assert.equal(url.hostname,'googleads.googleapis.com');
      const headers=new Headers(init?.headers);assert.equal(headers.get('developer-token'),null);assert.equal(headers.get('Authorization'),'Bearer fixture-renewed');assert.equal(headers.get('login-customer-id'),null);
      if(url.pathname.endsWith('customers:listAccessibleCustomers'))return Response.json({resourceNames:['customers/1234567890']});
      assert.ok(url.pathname.endsWith('/googleAds:searchStream'));
      return Response.json([{results:[{customer:{id:'1234567890',descriptiveName:'Google fixture',currencyCode:'BRL',timeZone:'America/Bahia',manager:false,status:'ENABLED'}}]}]);
    };
    try{
      const start=await oauthStart(admin,null,'google');const location=new URL(start.headers.get('location')!);const state=location.searchParams.get('state')!;
      assert.equal(location.searchParams.get('access_type'),'offline');
      const request=new Request('https://example.com/api/oauth/google/callback?'+new URLSearchParams({state,code:'fixture-code'}));
      await assert.rejects(oauthCallback(request,{...admin,id:randomUUID()},'google'),/cancelada ou expirada/);assert.equal(tokenCalls,0);
      assert.equal((await oauthCallback(request,admin,'google')).status,307);
      await assert.rejects(oauthCallback(request,admin,'google'),/cancelada ou expirada/);assert.equal(tokenCalls,2);
      const connected=(await db.query("SELECT * FROM connections WHERE platform='google' ORDER BY created_at DESC LIMIT 1")).rows[0];
      assert.ok(connected);assert.equal(connected.client_id,null);assert.equal(connected.import_status,'synced');assert.ok(!connected.credentials.includes('fixture-refresh'));
      const imported=(await db.query("SELECT * FROM ad_accounts WHERE platform='google' AND external_id='1234567890'")).rows[0];assert.ok(imported);assert.equal(imported.client_id,null);
      const accounts=await listRemoteAccounts(connected);assert.equal(accounts[0].externalId,'1234567890');assert.equal(refreshCalls,1);
      connected.credentials=encrypt(JSON.stringify({access_token:'fixture-expired',refresh_token:'fixture-refresh',expires_at:1}));
      await db.query('UPDATE connections SET credentials=$2 WHERE id=$1',[connected.id,connected.credentials]);revoked=true;
      await assert.rejects(accessToken(connected));assert.equal((await db.query('SELECT status FROM connections WHERE id=$1',[connected.id])).rows[0].status,'reconnect');
    }finally{globalThis.fetch=savedFetch;for(const key of envKeys){if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}}
  });
  await t.test('worker Google valida, cria pausado e mantém ativação independente',async()=>{
   const beforeFetch=globalThis.fetch,googleCalls:any[]=[];process.env.GOOGLE_ADS_API_VERSION='v23';
   globalThis.fetch=async(input,init)=>{const u=new URL(String(input));assert.equal(u.hostname,'googleads.googleapis.com');const body=JSON.parse(String(init?.body));googleCalls.push(body);if(u.pathname.endsWith('searchStream'))return Response.json([{results:[{conversionAction:{status:'ENABLED',primaryForGoal:true}}]}]);if(body.validateOnly)return Response.json({});return Response.json({mutateOperationResponses:body.mutateOperations.map((op:any,i:number)=>{const key=Object.keys(op)[0].replace('Operation','Result');return {[key]:{resourceName:`customers/7775553331/${key}/${i+1}`}};})});};
   try{const account=(await db.query("SELECT * FROM ad_accounts WHERE external_id='7775553331'")).rows[0];const input={name:'Google piloto',offer:'Conheça nossa equipe e agende',location:'Salvador',startDate:'2027-01-01',endDate:'2027-01-30',channels:[{platform:'google',kind:'google_search',accountId:account.id,dailyBudget:50,destination:'https://example.com',conversionId:'123',geoTargetId:'1001593',keywords:['consulta particular'],negatives:['grátis'],headlines:['Agende uma consulta','Conheça nossa equipe','Atendimento em Salvador'],descriptions:['Entre em contato e conheça nossa equipe.','Atendimento particular em Salvador.']}]};const c=await saveCampaign(operator,client.id,input);await campaignAction(operator,c.id,'propose',1);await campaignAction(approver,c.id,'approve',1);process.env.ADS_ACTIVATION_ENABLED='false';await campaignAction(operator,c.id,'create',1);const jobId=(await db.query("SELECT id FROM jobs WHERE campaign_id=$1 AND kind='create'",[c.id])).rows[0].id;const job=await claimJob(jobId);assert.ok(job);await runJob(job);assert.equal((await db.query('SELECT status FROM campaigns WHERE id=$1',[c.id])).rows[0].status,'paused');assert.equal(googleCalls.length,3);const mutation=googleCalls[2];assert.equal(mutation.partialFailure,false);for(const op of mutation.mutateOperations){for(const key of ['campaignOperation','adGroupOperation','adGroupAdOperation'])if(op[key])assert.equal(op[key].create.status,'PAUSED');}await assert.rejects(campaignAction(approver,c.id,'activate',1),/Ativação bloqueada/);assert.equal(googleCalls.length,3);
   }finally{globalThis.fetch=beforeFetch;process.env.ADS_ACTIVATION_ENABLED='true';}
  });
  await t.test('carteira agrega sem multiplicar totais, isola perfis e omite segredos',async()=>{
    const {portfolioOverview}=await import('../../src/lib/portfolio');
    const a=(await db.query("INSERT INTO clients(name) VALUES('Portfolio Clínica A') RETURNING id")).rows[0];
    const b=(await db.query("INSERT INTO clients(name) VALUES('Portfolio Clínica B') RETURNING id")).rows[0];
    const empty=(await db.query("INSERT INTO clients(name) VALUES('Portfolio Sem Conta') RETURNING id")).rows[0];
    await db.query('INSERT INTO client_members(client_id,user_id) VALUES($1,$2),($1,$3)',[a.id,operator.id,approver.id]);
    const connection=(await db.query("INSERT INTO connections(platform,credentials,status,import_status) VALUES('meta','private-fixture-token','reconnect','error') RETURNING id")).rows[0];
    for(let i=0;i<2;i++)await db.query("INSERT INTO ad_accounts(client_id,connection_id,platform,external_id,name,currency,timezone) VALUES($1,$2,'meta',$3,'Fixture','BRL','America/Bahia')",[a.id,connection.id,`portfolio_${i}`]);
    const active=(await db.query("INSERT INTO campaigns(client_id,name,created_by,status,version) VALUES($1,'Ativa',$2,'active',2) RETURNING id",[a.id,admin.id])).rows[0];
    const proposed=(await db.query("INSERT INTO campaigns(client_id,name,created_by,status) VALUES($1,'Revisar',$2,'proposed') RETURNING id",[a.id,admin.id])).rows[0];
    await db.query("INSERT INTO campaigns(client_id,name,created_by,status) VALUES($1,'Restricted campaign',$2,'proposed')",[b.id,admin.id]);
    await db.query("INSERT INTO jobs(client_id,campaign_id,version,kind,status,error) VALUES($1,$2,1,'create','failed','raw-secret-error'),($1,$2,2,'create','failed','raw-secret-error')",[a.id,active.id]);
    await db.query("INSERT INTO external_objects(campaign_id,version,account_id,object_key,external_id,kind,delivery_status) SELECT $1,1,id,'rejected','id','ad','REJECTED' FROM ad_accounts WHERE client_id=$2",[proposed.id,a.id]);
    await db.query("INSERT INTO audit_log(client_id,user_id,action,entity_id,detail) VALUES($1,$3,'briefing.saved','fixture','{\"private\":\"audit-secret\"}'),($2,$3,'client.created','fixture','{}')",[a.id,b.id,operator.id]);
    const adminView=await portfolioOverview(admin),operatorView=await portfolioOverview(operator),approverView=await portfolioOverview(approver);
    const row=adminView.clients.find(c=>c.id===a.id)!;
    assert.equal(row.accountCount,2);assert.equal(row.connectionIssues,2);assert.equal(row.campaignCount,2);assert.equal(row.reviewCount,1);assert.equal(row.activeCampaigns,1);assert.equal(row.failedJobs,1);assert.equal(row.errorCampaigns,1);
    assert.ok(adminView.clients.some(c=>c.id===b.id));assert.equal(adminView.clients.find(c=>c.id===empty.id)?.accountCount,0);
    for(const view of [operatorView,approverView]){assert.ok(view.clients.some(c=>c.id===a.id));assert.ok(!view.clients.some(c=>c.id===b.id||c.id===empty.id));assert.ok(!view.activity.some(e=>e.clientId===b.id));}
    assert.ok(operatorView.activity.some(e=>e.clientId===a.id&&e.action==='briefing.saved'));
    assert.ok(!JSON.stringify(adminView).includes('private-fixture-token'));assert.ok(!JSON.stringify(adminView).includes('raw-secret-error'));assert.ok(!JSON.stringify(adminView).includes('audit-secret'));
    const stranger=await portfolioOverview({...operator,id:randomUUID()});assert.deepEqual(stranger.clients,[]);assert.deepEqual(stranger.activity,[]);
    await db.query("INSERT INTO audit_log(client_id,action) SELECT $1,'fixture' FROM generate_series(1,55)",[a.id]);assert.equal((await portfolioOverview(operator)).activity.length,50);
  });
 }finally{globalThis.fetch=originalFetch;await new Promise<void>(resolve=>storage.close(()=>resolve()));await db.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
});

