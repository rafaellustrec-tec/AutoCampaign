import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db,transaction } from './db';
import type { User } from './auth';
import { AppError,requireRole,uuid } from './domain';

type Connection={id:string;platform:'meta'|'google';credentials:string};
const remoteAccount=z.object({externalId:z.string().min(1).max(100),name:z.string().min(1).max(300),currency:z.string().regex(/^[A-Z]{3}$/),timezone:z.string().min(1).max(100)});
type Discover=(connection:Connection)=>Promise<z.infer<typeof remoteAccount>[]>;

export async function synchronizeAccounts(user:User,connectionId:string,discover:Discover) {
  requireRole(user.role,[]);uuid.parse(connectionId);
  const lease=randomUUID();
  const connection=(await db.query("UPDATE connections SET import_status='running',import_token=$2,import_started_at=now(),import_error=NULL WHERE id=$1 AND (import_status<>'running' OR import_started_at<now()-interval '10 minutes') RETURNING id,platform,credentials,status",[connectionId,lease])).rows[0];
  if(!connection)throw new AppError(409,'Autorização não encontrada ou importação já em andamento.');
  try {
    if(connection.status!=='connected')throw new AppError(422,'Reconecte a conta para importar os ativos.');
    const accounts=z.array(remoteAccount).max(10000).parse(await discover(connection));
    const unique=[...new Map(accounts.map(a=>[a.externalId,a])).values()];
    await transaction(async tx=>{
      const current=await tx.query("SELECT 1 FROM connections WHERE id=$1 AND import_token=$2 AND import_status='running' FOR UPDATE",[connectionId,lease]);
      if(!current.rowCount)throw new AppError(409,'A importação expirou. Atualize a lista.');
      // Only complete provider snapshots may mark previously saved accounts unavailable.
      await tx.query('UPDATE ad_accounts SET available=false WHERE connection_id=$1 AND NOT (external_id=ANY($2::text[]))',[connectionId,unique.map(a=>a.externalId)]);
      await tx.query(`INSERT INTO ad_accounts(client_id,connection_id,platform,external_id,name,currency,timezone,available,last_seen_at)
        SELECT NULL,$1,$2,x."externalId",x.name,x.currency,x.timezone,true,now()
        FROM jsonb_to_recordset($3::jsonb) AS x("externalId" text,name text,currency text,timezone text)
        ORDER BY x."externalId"
        ON CONFLICT(platform,external_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,name=EXCLUDED.name,currency=EXCLUDED.currency,timezone=EXCLUDED.timezone,available=true,last_seen_at=now()`,[connectionId,connection.platform,JSON.stringify(unique)]);
      // client_id is deliberately absent from the UPDATE: reconnecting never moves clients.
      await tx.query("UPDATE connections SET import_status='synced',imported_at=now(),import_token=NULL,import_error=NULL WHERE id=$1 AND import_token=$2",[connectionId,lease]);
      await tx.query("INSERT INTO audit_log(user_id,action,entity_id,detail) VALUES($1,'accounts.imported',$2,$3)",[user.id,connectionId,JSON.stringify({platform:connection.platform,count:unique.length})]);
    });
    return {count:unique.length};
  }catch(error){
    const auth=error instanceof AppError&&error.message.includes('Reconecte');
    const code=auth?'AUTH_EXPIRED':error instanceof AppError&&error.status===429?'RATE_LIMIT':'IMPORT_FAILED';
    await db.query("UPDATE connections SET import_status='error',import_error=$3,import_token=NULL,status=CASE WHEN $4 THEN 'reconnect' ELSE status END WHERE id=$1 AND import_token=$2",[connectionId,lease,code,auth]);
    throw error;
  }
}

export async function savedAccounts(user:User) {
  requireRole(user.role,[]);
  return (await db.query(`SELECT a.id,a.platform,a.external_id,a.name,a.currency,a.timezone,a.client_id,a.available,a.last_seen_at,
    c.name AS client_name,co.status AS connection_status
    FROM ad_accounts a JOIN connections co ON co.id=a.connection_id LEFT JOIN clients c ON c.id=a.client_id ORDER BY a.name,a.id`)).rows;
}

export const assignmentsSchema=z.array(z.object({accountId:uuid,clientId:uuid})).min(1).max(500).superRefine((rows,ctx)=>{
  if(new Set(rows.map(r=>r.accountId)).size!==rows.length)ctx.addIssue({code:'custom',message:'Uma conta não pode aparecer duas vezes no mesmo lote.'});
});
export async function assignAccounts(user:User,input:unknown) {
  requireRole(user.role,[]);const assignments=assignmentsSchema.parse(input);
  return transaction(async tx=>{
    const ids=assignments.map(a=>a.accountId);const clientIds=[...new Set(assignments.map(a=>a.clientId))];
    const clients=await tx.query('SELECT id FROM clients WHERE id=ANY($1::uuid[])',[clientIds]);
    if(clients.rowCount!==clientIds.length)throw new AppError(404,'Um dos clientes não foi encontrado.');
    const rows=(await tx.query('SELECT a.id,a.client_id,a.available,c.status FROM ad_accounts a JOIN connections c ON c.id=a.connection_id WHERE a.id=ANY($1::uuid[]) ORDER BY a.id FOR UPDATE OF a',[ids])).rows;
    if(rows.length!==ids.length)throw new AppError(404,'Uma das contas não foi encontrada.');
    for(const row of rows){
      const target=assignments.find(a=>a.accountId===row.id)!;
      if(row.client_id&&row.client_id!==target.clientId)throw new AppError(409,'Uma das contas já pertence a outro cliente. Nenhum vínculo foi alterado.');
      if(!row.available||row.status!=='connected')throw new AppError(422,'Uma das contas está indisponível. Sincronize ou reconecte antes de vincular.');
    }
    const changed=(await tx.query(`UPDATE ad_accounts a SET client_id=x."clientId"
      FROM jsonb_to_recordset($1::jsonb) AS x("accountId" uuid,"clientId" uuid)
      WHERE a.id=x."accountId" AND a.client_id IS DISTINCT FROM x."clientId" RETURNING a.id,a.client_id`,[JSON.stringify(assignments)])).rows;
    for(const row of changed)await tx.query("INSERT INTO audit_log(client_id,user_id,action,entity_id) VALUES($1,$2,'account.linked',$3)",[row.client_id,user.id,row.id]);
    return {linked:changed.length};
  });
}
