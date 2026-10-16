import {db} from './db';
import {AppError} from './domain';

// Some Page tokens omit whatsapp_number even when Page settings show a linked
// number. A pilot may use a recent, server-recorded administrative inspection.
// There is deliberately no browser/API endpoint that can create this evidence.
export async function verifyPageWhatsApp(job:{campaign_id:string;client_id:string;version:number},accountId:string,pageId:string,number:string,reported:unknown){
 if(typeof reported==='string'&&reported.replace(/\D/g,'')){
  if(reported.replace(/\D/g,'')!==number)throw new AppError(422,'O WhatsApp informado não corresponde ao vinculado à Página.');
  return;
 }
 const scope=process.env.ADS_PUBLISH_CAMPAIGN_IDS?.split(',').map(id=>id.trim())??[];
 if(scope.includes(job.campaign_id)){
  const proof=await db.query(`SELECT 1 FROM audit_log a JOIN users u ON u.id=a.user_id
   WHERE a.client_id=$1 AND a.entity_id=$2 AND a.action='meta.whatsapp_verified'
    AND u.role='admin' AND NOT u.disabled AND a.created_at>now()-interval '4 hours'
    AND a.detail->>'version'=$3 AND a.detail->>'accountId'=$4
    AND a.detail->>'pageId'=$5 AND a.detail->>'number'=$6
    AND a.detail->>'source'='facebook_page_linked_whatsapp_settings'
    AND a.detail->>'proofSha256' ~ '^[0-9a-f]{64}$' LIMIT 1`,[job.client_id,job.campaign_id,String(job.version),accountId,pageId,number]);
  if(proof.rowCount)return;
 }
 throw new AppError(422,'O WhatsApp não foi retornado pela Página. Confirme o vínculo nas configurações da Meta antes de criar.');
}
