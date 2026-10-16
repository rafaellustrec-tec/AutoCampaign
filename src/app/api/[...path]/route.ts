import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db,transaction } from '@/lib/db';
import { requireUser,requireClient,checkOrigin } from '@/lib/auth';
import { AppError,requireRole,uuid } from '@/lib/domain';
import { hash,passwordMatches } from '@/lib/security';
import { saveCampaign,campaignAction,audit } from '@/lib/campaigns';
import { dispatchCampaignJob,dispatchWorkflow } from '@/lib/workflow-dispatch';
import { uploadUrl,freezeUpload,storePdf,downloadUrl,previewUrl } from '@/lib/storage';
import { oauthStart,oauthCallback,listRemoteAccounts } from '@/lib/oauth';
import { synchronizeAccounts,savedAccounts,assignAccounts } from '@/lib/account-registry';
import { publicationCapabilities } from '@/lib/publication-policy';
import { portfolioOverview } from '@/lib/portfolio';
import {listStrategies,getStrategy,saveStrategy,prepareStrategy,recordStrategyReview} from '@/lib/strategies';
import { reportPdf,reportData,reportConfigSchema,reportLogo } from '@/lib/reports';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
type Context={params:Promise<{path:string[]}>};
async function handler(request:Request,context:Context) {
 try {
  const {path}=await context.params; const method=request.method; const url=new URL(request.url);
  if(path[0]==='health'&&method==='GET') {try{await db.query('SELECT 1');return NextResponse.json({status:'ok'});}catch{return NextResponse.json({status:'unavailable'},{status:503});}}
  if(path[0]==='internal') throw new AppError(404,'As tarefas são executadas diretamente pelo worker.');
  if(method!=='GET') checkOrigin(request);
  if(path.join('/')==='auth/login'&&method==='POST') {
    const input=z.object({email:z.email().max(254),password:z.string().min(1).max(256)}).parse(await request.json());
    const email=input.email.toLowerCase();
    const attempt=(await db.query("INSERT INTO login_attempts(key,reset_at) VALUES($1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.attempts+1 END,reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING attempts",[hash(email)])).rows[0];
    if(attempt.attempts>10) throw new AppError(429,'Muitas tentativas. Tente novamente em 15 minutos.');
    const user=(await db.query('SELECT * FROM users WHERE email=$1 AND NOT disabled',[email])).rows[0];
    if(!user||!passwordMatches(input.password,user.password_hash)) throw new AppError(401,'E-mail ou senha inválidos.');
    const token=randomBytes(32).toString('hex');
    await db.query("INSERT INTO sessions(id_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[hash(token),user.id]);
    (await cookies()).set('agency_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:43200});
    return NextResponse.json({ok:true});
  }
  const user=await requireUser();
  if(path.join('/')==='auth/logout'&&method==='POST') { const jar=await cookies(); const token=jar.get('agency_session')?.value; if(token) await db.query('DELETE FROM sessions WHERE id_hash=$1',[hash(token)]); jar.delete('agency_session'); return NextResponse.json({ok:true}); }
  if(path.length===1&&path[0]==='publication-policy'&&method==='GET')return NextResponse.json(publicationCapabilities(),{headers:{'Cache-Control':'private, no-store'}});
  if(path.length===1&&path[0]==='portfolio'&&method==='GET')return NextResponse.json(await portfolioOverview(user),{headers:{'Cache-Control':'private, no-store'}});
  if(path[0]==='me'&&method==='GET') return NextResponse.json(user);
  if(path[0]==='oauth') {
    if(method!=='GET') throw new AppError(405,'Método não permitido.');
    const provider=z.enum(['meta','google']).parse(path[1]);
    if(path[2]==='callback') return await oauthCallback(request,user,provider);
    requireRole(user.role,[]); const clientId=url.searchParams.has('clientId')?uuid.parse(url.searchParams.get('clientId')):null;
    if(clientId)await requireClient(user,clientId);return await oauthStart(user,clientId,provider);
  }
  if(path[0]==='accounts'&&path.length===1&&method==='GET')return NextResponse.json(await savedAccounts(user));
  if(path.join('/')==='accounts/assign'&&method==='POST')return NextResponse.json(await assignAccounts(user,(await request.json()).assignments));
  if(path[0]==='connections') {
    requireRole(user.role,[]);
    if(path.length===1&&method==='GET')return NextResponse.json((await db.query('SELECT id,platform,status,created_at,import_status,imported_at,import_error FROM connections ORDER BY created_at DESC')).rows);
    if(path.length===3&&path[2]==='sync'&&method==='POST')return NextResponse.json(await synchronizeAccounts(user,uuid.parse(path[1]),listRemoteAccounts));
  }
  if(path[0]==='users') { requireRole(user.role,[]); if(method==='GET') return NextResponse.json((await db.query('SELECT id,name,email,role,disabled FROM users ORDER BY name')).rows); }
  if(path[0]==='clients'&&path.length===1) {
    if(method==='GET') return NextResponse.json((await db.query('SELECT c.* FROM clients c WHERE $1 OR EXISTS(SELECT 1 FROM client_members m WHERE m.client_id=c.id AND m.user_id=$2) ORDER BY c.name',[user.role==='admin',user.id])).rows);
    if(method==='POST') { requireRole(user.role,['operator']); const {name}=z.object({name:z.string().trim().min(2).max(150)}).parse(await request.json());
      const client=await transaction(async tx=>{ const c=(await tx.query('INSERT INTO clients(name) VALUES($1) RETURNING *',[name])).rows[0]; await tx.query('INSERT INTO client_members(client_id,user_id) VALUES($1,$2)',[c.id,user.id]); await audit(tx,user,c.id,'client.created',c.id); return c; }); return NextResponse.json(client,{status:201}); }
  }
  if(path[0]==='clients'&&path[1]) {
    const clientId=uuid.parse(path[1]); await requireClient(user,clientId);
    if(path[2]==='strategies') {
      if(path.length===3&&method==='GET')return NextResponse.json(await listStrategies(user,clientId),{headers:{'Cache-Control':'private, no-store'}});
      if(path.length===4&&method==='GET')return NextResponse.json(await getStrategy(user,clientId,path[3]),{headers:{'Cache-Control':'private, no-store'}});
      if(path.length===4&&method==='PUT')return NextResponse.json(await saveStrategy(user,clientId,path[3],await request.json()));
      if(path.length===5&&path[4]==='prepare'&&method==='POST'){const {version}=z.object({version:z.number().int().positive()}).parse(await request.json());return NextResponse.json(await prepareStrategy(user,clientId,path[3],version));}
      if(path.length===5&&path[4]==='reviews'&&method==='POST'){const {notes}=z.object({notes:z.string().trim().min(3).max(2000)}).parse(await request.json());return NextResponse.json(await recordStrategyReview(user,clientId,path[3],notes));}
    }
    if(path[2]==='members'&&method==='POST') { requireRole(user.role,[]); const {userId}=z.object({userId:uuid}).parse(await request.json()); await transaction(async tx=>{ await tx.query('INSERT INTO client_members(client_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[clientId,userId]); await audit(tx,user,clientId,'member.granted',userId); }); return NextResponse.json({ok:true}); }
    if(path[2]==='accounts'&&method==='GET') return NextResponse.json((await db.query("SELECT a.*,CASE WHEN a.available THEN c.status ELSE 'unavailable' END AS connection_status FROM ad_accounts a JOIN connections c ON c.id=a.connection_id WHERE a.client_id=$1 ORDER BY a.name",[clientId])).rows);
    if(path[2]==='connections'&&path.length===3&&method==='GET') return NextResponse.json((await db.query('SELECT id,platform,status,created_at FROM connections WHERE client_id=$1',[clientId])).rows);
    if(path[2]==='connections'&&path[3]&&path[4]==='accounts') {
      requireRole(user.role,[]); const connectionId=uuid.parse(path[3]);
      const connection=(await db.query('SELECT * FROM connections WHERE id=$1 AND client_id=$2',[connectionId,clientId])).rows[0]; if(!connection) throw new AppError(404,'Conexão não encontrada.');
      const remote=await listRemoteAccounts(connection);
      if(method==='GET') return NextResponse.json(remote);
      if(method==='POST') {
        const {externalId}=z.object({externalId:z.string().min(1)}).parse(await request.json()); const account=remote.find(a=>a.externalId===externalId); if(!account) throw new AppError(422,'Conta não autorizada.');
        const result=await transaction(async tx=>{ const existing=await tx.query('SELECT client_id FROM ad_accounts WHERE platform=$1 AND external_id=$2',[connection.platform,externalId]); if(existing.rowCount&&existing.rows[0].client_id!==clientId) throw new AppError(409,'Conta já vinculada a outro cliente.');
          const row=(await tx.query('INSERT INTO ad_accounts(client_id,connection_id,platform,external_id,name,currency,timezone) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(platform,external_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,name=EXCLUDED.name,currency=EXCLUDED.currency,timezone=EXCLUDED.timezone RETURNING *',[clientId,connectionId,connection.platform,externalId,account.name,account.currency,account.timezone])).rows[0]; await audit(tx,user,clientId,'account.linked',row.id); return row; }); return NextResponse.json(result);
      }
    }
    if(path[2]==='campaigns') {
      if(method==='GET') return NextResponse.json((await db.query("SELECT c.*,v.briefing,v.proposal,(SELECT CASE WHEN bool_or(o.delivery_status='REJECTED') THEN 'REJECTED' WHEN bool_or(o.delivery_status='IN_REVIEW') THEN 'IN_REVIEW' ELSE NULL END FROM external_objects o WHERE o.campaign_id=c.id AND o.version=c.version AND o.kind='ad') AS delivery_status FROM campaigns c JOIN campaign_versions v ON v.campaign_id=c.id AND v.version=c.version WHERE c.client_id=$1 ORDER BY c.created_at DESC",[clientId])).rows);
      if(method==='POST') return NextResponse.json(await saveCampaign(user,clientId,await request.json()),{status:201});
    }
    if(path[2]==='assets') {
      if(path.length===5&&path[4]==='preview'&&method==='GET'){const asset=(await db.query("SELECT storage_key FROM assets WHERE id=$1 AND client_id=$2 AND status='ready' AND content_type IN ('image/png','image/jpeg','image/webp')",[uuid.parse(path[3]),clientId])).rows[0];if(!asset)throw new AppError(404,'Imagem indisponível.');return NextResponse.redirect(await previewUrl(asset.storage_key),{headers:{'Cache-Control':'private, no-store'}});}
      if(method==='GET') return NextResponse.json((await db.query('SELECT * FROM assets WHERE client_id=$1 ORDER BY created_at DESC',[clientId])).rows);
      requireRole(user.role,['operator']);
      if(path[3]&&path[4]==='confirm'&&method==='POST') {const id=uuid.parse(path[3]);await transaction(async tx=>{const asset=(await tx.query('SELECT * FROM assets WHERE id=$1 AND client_id=$2 FOR UPDATE',[id,clientId])).rows[0];if(!asset)throw new AppError(404,'Material não encontrado.');if(asset.status==='ready')return;const key=`${clientId}/assets/${id}`;await freezeUpload(asset.storage_key,key,asset.content_type,Number(asset.size));await tx.query("UPDATE assets SET status='ready',storage_key=$2 WHERE id=$1",[id,key]);await audit(tx,user,clientId,'asset.ready',id);});return NextResponse.json({ok:true});}
      if(method==='POST'&&!path[3]) {
        const input=z.object({name:z.string().min(1).max(200),contentType:z.enum(['image/jpeg','image/png','image/webp']),size:z.number().int().positive().max(30*1024*1024)}).parse(await request.json()); const id=randomUUID(); const key=`${clientId}/incoming/${id}`; const signedUrl=await uploadUrl(key,input.contentType,input.size);
        await db.query('INSERT INTO assets(id,client_id,name,storage_key,content_type,size) VALUES($1,$2,$3,$4,$5,$6)',[id,clientId,input.name,key,input.contentType,input.size]); return NextResponse.json({id,url:signedUrl});
      }
    }
    if(path[2]==='jobs'&&method==='GET') return NextResponse.json((await db.query('SELECT id,campaign_id,version,kind,status,attempts,error,created_at,updated_at FROM jobs WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100',[clientId])).rows);
    if(path[2]==='audit'&&method==='GET') return NextResponse.json((await db.query('SELECT a.*,u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.client_id=$1 ORDER BY a.id DESC LIMIT 100',[clientId])).rows);
    if(path[2]==='reports'&&path[3]==='history'&&method==='GET') {
      if(path[4]) {const row=(await db.query('SELECT storage_key FROM report_snapshots WHERE id=$1 AND client_id=$2',[uuid.parse(path[4]),clientId])).rows[0];if(!row)throw new AppError(404,'Relatório não encontrado.');return NextResponse.redirect(await downloadUrl(row.storage_key));}
      return NextResponse.json((await db.query('SELECT id,period_start,period_end,config,created_at FROM report_snapshots WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100',[clientId])).rows);
    }
    if(path[2]==='reports'&&method==='POST') {
      requireRole(user.role,['operator']);const input=z.object({from:z.iso.date(),to:z.iso.date(),config:reportConfigSchema}).parse(await request.json());if(input.from>input.to)throw new AppError(422,'Período inválido.');
      const data=await reportData(clientId,input.from,input.to);const logo=await reportLogo(clientId,input.config.logoAssetId);const bytes=await reportPdf(data,input.config.brand,input.config,logo);const id=randomUUID();const key=`${clientId}/reports/${id}.pdf`;await storePdf(key,bytes);
      await transaction(async tx=>{await tx.query('INSERT INTO report_snapshots(id,client_id,created_by,period_start,period_end,config,data,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,clientId,user.id,input.from,input.to,JSON.stringify(input.config),JSON.stringify(data),key]);await audit(tx,user,clientId,'report.saved',id);});return NextResponse.json({id},{status:201});
    }
    if(path[2]==='reports'&&method==='GET') {
      const from=z.iso.date().parse(url.searchParams.get('from'));const to=z.iso.date().parse(url.searchParams.get('to')); if(from>to) throw new AppError(422,'Período inválido.');
      const data=await reportData(clientId,from,to);
      if(path[3]==='pdf') {const config=reportConfigSchema.parse({brand:url.searchParams.get('brand')??undefined,color:url.searchParams.get('color')??undefined,blocks:url.searchParams.get('blocks')?.split(','),logoAssetId:url.searchParams.get('logoAssetId')||undefined});return new Response(await reportPdf(data,config.brand,config,await reportLogo(clientId,config.logoAssetId)),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="relatorio.pdf"','Cache-Control':'no-store'}});}
      return NextResponse.json(data);
    }
  }
  if(path[0]==='campaigns'&&path[1]) {
    const id=uuid.parse(path[1]);
    if(method==='PUT'&&path.length===2) { const row=(await db.query('SELECT client_id FROM campaigns WHERE id=$1',[id])).rows[0]; if(!row) throw new AppError(404,'Campanha não encontrada.'); return NextResponse.json(await saveCampaign(user,row.client_id,await request.json(),id)); }
    if(method==='POST'&&path[2]) {
      const action=z.enum(['propose','approve','create','activate']).parse(path[2]);
      const {version}=z.object({version:z.number().int().positive()}).parse(await request.json());
      const campaign=await campaignAction(user,id,action,version);
      let dispatchPending=false;
      if(action==='create'||action==='activate')try{await dispatchCampaignJob(id,action,version);}catch{dispatchPending=true;console.error('Workflow dispatch pending; durable job retained.');}
      return NextResponse.json({...campaign,dispatchPending});
    }
  }
  if(path[0]==='jobs'&&path[1]&&path[2]==='retry'&&method==='POST') {
    requireRole(user.role,['operator']);const id=uuid.parse(path[1]);
    await transaction(async tx=>{
      const job=(await tx.query("SELECT * FROM jobs WHERE id=$1 AND status='failed' FOR UPDATE",[id])).rows[0];if(!job)throw new AppError(409,'Execução não está disponível para retentativa.');
      await requireClient(user,job.client_id,tx);
      const uncertain=await tx.query("SELECT 1 FROM provider_operations WHERE campaign_id=$1 AND version=$2 AND state<>'succeeded'",[job.campaign_id,job.version]);if(uncertain.rowCount)throw new AppError(409,'Reconciliação manual dos objetos externos necessária antes da retentativa.');
      await tx.query("UPDATE jobs SET status='queued',attempts=0,available_at=now(),error=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1",[id]);
      await tx.query('UPDATE campaigns SET status=$2,updated_at=now() WHERE id=$1',[job.campaign_id,job.kind==='create'?'creating':'activating']);await audit(tx,user,job.client_id,'job.retried',id);
    });let dispatchPending=false;if(process.env.JOB_EXECUTOR==='vercel')try{await dispatchWorkflow(id);}catch{dispatchPending=true;}return NextResponse.json({ok:true,dispatchPending});
  }
  throw new AppError(404,'Recurso não encontrado.');
 } catch(error) {
  if(error instanceof z.ZodError) return NextResponse.json({error:'Dados inválidos.',issues:error.issues},{status:422});
  if(error instanceof AppError) return NextResponse.json({error:error.message},{status:error.status});
  console.error('API failure',error instanceof Error?error.name:'Unknown');
  return NextResponse.json({error:'Não foi possível concluir. Verifique a configuração e tente novamente.'},{status:500});
 }
}
export { handler as GET,handler as POST,handler as PUT };
