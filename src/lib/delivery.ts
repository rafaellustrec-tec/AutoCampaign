import { db } from './db';
import { googleRequest,providerJson } from './oauth';
export async function syncDelivery(account:{id:string;platform:string;external_id:string},token:string) {
 if(account.platform==='google') {
  const batches=await googleRequest(token,`customers/${account.external_id}/googleAds:searchStream`,{query:'SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.policy_summary.approval_status FROM ad_group_ad'});
  for(const batch of batches)for(const row of batch.results??[]) {
   const ad=row.adGroupAd;const approval=ad.policySummary?.approvalStatus;
   const state=approval==='DISAPPROVED'?'REJECTED':approval==='UNDER_REVIEW'?'IN_REVIEW':ad.status==='ENABLED'?'ACTIVE':'PAUSED';
   await db.query("UPDATE external_objects SET delivery_status=$3 WHERE account_id=$1 AND external_id=$2 AND kind='ad'",[account.id,ad.resourceName,state]);
  }
 } else {
  const objects=(await db.query("SELECT id,external_id FROM external_objects WHERE account_id=$1 AND kind='ad'",[account.id])).rows;
  for(const object of objects){
   const row=await providerJson(`https://graph.facebook.com/${process.env.META_API_VERSION}/${object.external_id}?fields=effective_status`,{headers:{Authorization:`Bearer ${token}`}});
   const state=['DISAPPROVED','WITH_ISSUES'].includes(row.effective_status)?'REJECTED':['PENDING_REVIEW','PREAPPROVED'].includes(row.effective_status)?'IN_REVIEW':row.effective_status==='ACTIVE'?'ACTIVE':'PAUSED';
   await db.query('UPDATE external_objects SET delivery_status=$2 WHERE id=$1',[object.id,state]);
  }
 }
}
