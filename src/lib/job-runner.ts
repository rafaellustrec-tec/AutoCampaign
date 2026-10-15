import { randomUUID } from 'node:crypto';
import { requireActivationEnabled } from './publication-policy';
import type { PoolClient } from 'pg';
import { db, transaction } from './db';
import { AppError } from './domain';
import { executePublication } from './publishers';

export type Job = {id:string;client_id:string;campaign_id:string;version:number;kind:'create'|'activate'|'sync';lease_token:string;attempts:number;max_attempts:number};
export async function claimJob(id?:string):Promise<Job|null> {
  return transaction(async tx=>{
    const expired=await tx.query("UPDATE jobs SET status='failed',error='AMBIGUOUS_RESULT: execução sem confirmação; reconcilie antes de repetir.',updated_at=now() WHERE status='running' AND lease_until<now() RETURNING campaign_id");
    for(const row of expired.rows) if(row.campaign_id) await tx.query("UPDATE campaigns SET status='error',updated_at=now() WHERE id=$1",[row.campaign_id]);
    const row=(await tx.query("SELECT * FROM jobs WHERE status='queued' AND available_at<=now() AND attempts<max_attempts AND ($1::uuid IS NULL OR id=$1) ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1",[id??null])).rows[0];
    if(!row) return null;
    return (await tx.query("UPDATE jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=$1 RETURNING *",[row.id,randomUUID()])).rows[0];
  });
}
export async function validateJob(tx:PoolClient,id:string,lease:string):Promise<Job> {
  const job=(await tx.query("SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",[id,lease])).rows[0];
  if(!job) throw new AppError(409,'Execução expirada ou já concluída.');
  if(!['create','activate'].includes(job.kind)) throw new AppError(422,'Tipo de tarefa fora do piloto Meta WhatsApp.');
  requireActivationEnabled(job.kind);
  const campaign=(await tx.query('SELECT version,status FROM campaigns WHERE id=$1 FOR UPDATE',[job.campaign_id])).rows[0];
  if(!campaign||campaign.version!==job.version||campaign.status!==(job.kind==='create'?'creating':'activating')) throw new AppError(409,'Versão ou estado da campanha divergente.');
  const approval=await tx.query('SELECT 1 FROM approvals WHERE campaign_id=$1 AND version=$2 AND kind=$3',[job.campaign_id,job.version,job.kind==='activate'?'activate':'create']);
  if(!approval.rowCount) throw new AppError(409,'Aprovação ausente.');
  return job;
}
export async function heartbeatJob(id:string,lease:string) {
  await transaction(async tx=>{await validateJob(tx,id,lease);await tx.query("UPDATE jobs SET lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=$1",[id]);});
}
export async function completeJob(id:string,lease:string) {
  return transaction(async tx=>{
    const job=await validateJob(tx,id,lease);
    const version=(await tx.query('SELECT briefing FROM campaign_versions WHERE campaign_id=$1 AND version=$2',[job.campaign_id,job.version])).rows[0];
    const required=job.kind==='create'?'PAUSED':'ACTIVE';
    for(const channel of version.briefing.channels) {
      const result=await tx.query('SELECT kind,delivery_status FROM external_objects WHERE campaign_id=$1 AND version=$2 AND account_id=$3',[job.campaign_id,job.version,channel.accountId]);
      for(const kind of ['campaign','adset','ad']) {
        const rows=result.rows.filter(o=>o.kind===kind);
        if(!rows.length||rows.some(o=>o.delivery_status!==required)) throw new AppError(409,'Estrutura externa incompleta ou status não confirmado.');
      }
      if(result.rows.filter(o=>o.kind==='ad').length!==channel.assetIds.length) throw new AppError(409,'Nem todos os materiais aprovados possuem anúncio confirmado.');
    }
    await tx.query('UPDATE campaigns SET status=$2,updated_at=now() WHERE id=$1',[job.campaign_id,job.kind==='create'?'paused':'active']);
    await tx.query("UPDATE jobs SET status='succeeded',lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1",[id]);
    await tx.query("INSERT INTO audit_log(client_id,action,entity_id,detail) VALUES($1,'job.completed',$2,$3)",[job.client_id,id,JSON.stringify({kind:job.kind,version:job.version,executor:'native'})]);
  });
}
export async function failJob(id:string,lease:string,error:unknown) {
  return transaction(async tx=>{
    const job=await validateJob(tx,id,lease);
    const uncertain=await tx.query("SELECT 1 FROM provider_operations WHERE campaign_id=$1 AND version=$2 AND state<>'succeeded'",[job.campaign_id,job.version]);
    const code=uncertain.rowCount?'AMBIGUOUS_RESULT':error instanceof AppError?(error.status===429?'RATE_LIMIT':error.status>=500?'PROVIDER_UNAVAILABLE':error.message.includes('Reconecte')?'AUTH_EXPIRED':'INVALID_CONFIGURATION'):'PROVIDER_UNAVAILABLE';
    const retry=['RATE_LIMIT','PROVIDER_UNAVAILABLE'].includes(code)&&job.attempts<job.max_attempts;
    await tx.query("UPDATE jobs SET status=$2,error=$3,available_at=now()+($4*interval '1 second'),lease_until=NULL,updated_at=now() WHERE id=$1",[id,retry?'queued':'failed',code,Math.min(3600,30*2**job.attempts)]);
    if(!retry)await tx.query("UPDATE campaigns SET status='error',updated_at=now() WHERE id=$1",[job.campaign_id]);
    await tx.query("INSERT INTO audit_log(client_id,action,entity_id,detail) VALUES($1,'job.failed',$2,$3)",[job.client_id,id,JSON.stringify({code,retry,attempt:job.attempts})]);
    return {status:retry?'queued':'failed',code};
  });
}
// Called only by the process that atomically claimed this lease. A workflow
// retry claims again by ID and never reuses a serialized lease token.
export async function runClaimedJob(job:Job,execute:(job:Job)=>Promise<void>=executePublication) {
  let heartbeat:ReturnType<typeof setInterval>|undefined;let pending:Promise<void>|undefined;
  try {
    await transaction(tx=>validateJob(tx,job.id,job.lease_token));
    heartbeat=setInterval(()=>{if(!pending)pending=heartbeatJob(job.id,job.lease_token).catch(()=>{}).finally(()=>{pending=undefined;});},30000);
    await execute(job);
    await completeJob(job.id,job.lease_token);
    return {status:'succeeded'};
  }catch(error){
    try{return await failJob(job.id,job.lease_token,error);}catch{return {status:'lost_lease'};}
  }finally{
    if(heartbeat)clearInterval(heartbeat);if(pending)await pending;
  }
}
export async function runJob(job:Job,execute:(job:Job)=>Promise<void>=executePublication) {
  const guard=await db.connect();let locked=false;
  try {
    locked=(await guard.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[job.id])).rows[0].locked;
    if(!locked)return {status:'already_running'};
    return await runClaimedJob(job,execute);
  }finally{
    try{if(locked)await guard.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[job.id]);}finally{guard.release();}
  }
}
