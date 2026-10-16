import type { PoolClient } from 'pg';
import { requireActivationEnabled,requireCreationAllowed } from './publication-policy';
import { transaction } from './db';
import { requireClient,type User } from './auth';
import { AppError,campaignBriefingSchema,makeProposal,requireRole,requireTransition,type Briefing } from './domain';
export async function audit(tx:PoolClient,user:User,clientId:string,action:string,entity:string,detail:unknown={}) { await tx.query('INSERT INTO audit_log(client_id,user_id,action,entity_id,detail) VALUES($1,$2,$3,$4,$5)',[clientId,user.id,action,entity,JSON.stringify(detail)]); }
export async function validateReferences(tx:PoolClient,clientId:string,briefing:Briefing) {
  for(const channel of briefing.channels) {
    const account=await tx.query("SELECT a.id FROM ad_accounts a JOIN connections c ON c.id=a.connection_id WHERE a.id=$1 AND a.client_id=$2 AND a.platform=$3 AND a.available AND c.status='connected'",[channel.accountId,clientId,channel.platform]);
    if(!account.rowCount) throw new AppError(422,'Conta indisponível ou pertencente a outro cliente.');
    if(channel.assetIds.length) {
      const assets=await tx.query("SELECT id FROM assets WHERE client_id=$1 AND id=ANY($2::uuid[]) AND status='ready'",[clientId,channel.assetIds]);
      if(assets.rowCount!==new Set(channel.assetIds).size) throw new AppError(422,'Material indisponível ou pertencente a outro cliente.');
      const incompatible=await tx.query("SELECT 1 FROM assets WHERE id=ANY($1::uuid[]) AND (content_type NOT IN ('image/jpeg','image/png','image/webp') OR size>31457280)",[channel.assetIds]);
      if(incompatible.rowCount)throw new AppError(422,'O piloto WhatsApp aceita somente imagens de até 30 MB.');
    }
  }
}
export async function saveCampaign(user:User,clientId:string,input:unknown,campaignId?:string) {
  requireRole(user.role,['operator']); const briefing=campaignBriefingSchema.parse(input);
  return transaction(async tx=>{
    await requireClient(user,clientId,tx); await validateReferences(tx,clientId,briefing);
    let campaign;
    if(campaignId) {
      campaign=(await tx.query('SELECT * FROM campaigns WHERE id=$1 AND client_id=$2 FOR UPDATE',[campaignId,clientId])).rows[0];
      if(!campaign) throw new AppError(404,'Campanha não encontrada.');
      requireTransition(campaign.status,'revise');
      campaign=(await tx.query("UPDATE campaigns SET version=version+1,name=$2,status='draft',updated_at=now() WHERE id=$1 RETURNING *",[campaignId,briefing.name])).rows[0];
    } else campaign=(await tx.query('INSERT INTO campaigns(client_id,name,created_by) VALUES($1,$2,$3) RETURNING *',[clientId,briefing.name,user.id])).rows[0];
    await tx.query('INSERT INTO campaign_versions(campaign_id,version,briefing) VALUES($1,$2,$3)',[campaign.id,campaign.version,JSON.stringify(briefing)]);
    await audit(tx,user,clientId,'briefing.saved',campaign.id,{version:campaign.version}); return campaign;
  });
}
export async function campaignAction(user:User,id:string,action:string,expectedVersion:number) {
  requireRole(user.role,action==='approve'||action==='activate'?['approver']:['operator']);
  requireActivationEnabled(action);
  return transaction(async tx=>{
    const campaign=(await tx.query('SELECT * FROM campaigns WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!campaign) throw new AppError(404,'Campanha não encontrada.');
    await requireClient(user,campaign.client_id,tx);
    if(campaign.version!==expectedVersion) throw new AppError(409,'A versão mudou. Atualize a página e revise novamente.');
    requireTransition(campaign.status,action);
    const version=(await tx.query('SELECT * FROM campaign_versions WHERE campaign_id=$1 AND version=$2',[id,expectedVersion])).rows[0];
    await validateReferences(tx,campaign.client_id,campaignBriefingSchema.parse(version.briefing));
    let status:string;
    if(action==='propose') {
      await tx.query('UPDATE campaign_versions SET proposal=$3 WHERE campaign_id=$1 AND version=$2',[id,expectedVersion,JSON.stringify(makeProposal(version.briefing))]);
      await tx.query('DELETE FROM approvals WHERE campaign_id=$1 AND version=$2',[id,expectedVersion]); status='proposed';
    } else if(action==='approve') {
      if(!version.proposal) throw new AppError(409,'Gere a proposta antes de aprovar.');
      await tx.query("INSERT INTO approvals(campaign_id,version,kind,user_id) VALUES($1,$2,'create',$3)",[id,expectedVersion,user.id]); status='approved';
    } else {
      if(action==='create')requireCreationAllowed(id);
      if(process.env.ADS_PUBLISH_ENABLED!=='true') throw new AppError(422,'Publicação indisponível: valide a integração Meta WhatsApp e habilite ADS_PUBLISH_ENABLED no servidor.');
      if(process.env.VERCEL==='1'&&process.env.JOB_EXECUTOR!=='vercel')throw new AppError(422,'Configure JOB_EXECUTOR=vercel antes de publicar nesta hospedagem.');
      const approval=await tx.query("SELECT 1 FROM approvals WHERE campaign_id=$1 AND version=$2 AND kind='create'",[id,expectedVersion]);
      if(!approval.rowCount) throw new AppError(409,'A versão atual não foi aprovada.');
      if(action==='activate') {
        const objects=await tx.query("SELECT 1 FROM external_objects WHERE campaign_id=$1 AND version=$2 AND kind='campaign' AND delivery_status='PAUSED'",[id,expectedVersion]);
        if(objects.rowCount!==version.briefing.channels.length) throw new AppError(409,'Todas as campanhas precisam estar confirmadas como pausadas.');
        await tx.query("INSERT INTO approvals(campaign_id,version,kind,user_id) VALUES($1,$2,'activate',$3)",[id,expectedVersion,user.id]);
      }
      await tx.query('INSERT INTO jobs(client_id,campaign_id,version,kind) VALUES($1,$2,$3,$4)',[campaign.client_id,id,expectedVersion,action]); status=action==='create'?'creating':'activating';
    }
    await tx.query('UPDATE campaigns SET status=$2,updated_at=now() WHERE id=$1',[id,status]);
    await audit(tx,user,campaign.client_id,`campaign.${action}`,id,{version:expectedVersion});
    return {...campaign,status};
  });
}
