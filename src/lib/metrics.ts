import { db,transaction } from './db';
import { accessToken,googleRequest,providerJson } from './oauth';
import { AppError } from './domain';
import { syncDelivery } from './delivery';
function accountToday(timezone:string) {return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export async function syncAllAccounts(accountId?:string) {
 const accounts=(await db.query("SELECT a.*,c.credentials FROM ad_accounts a JOIN connections c ON c.id=a.connection_id WHERE c.status='connected' AND ($1::uuid IS NULL OR a.id=$1) ORDER BY a.id",[accountId??null])).rows;
 const results:{accountId:string;status:string}[]=[];
 for(const account of accounts){
  const run=(await db.query('INSERT INTO sync_runs(account_id) VALUES($1) RETURNING id',[account.id])).rows[0];
  try {
   const token=await accessToken({id:account.connection_id,platform:account.platform,credentials:account.credentials});const to=accountToday(account.timezone);const from=new Date(Date.parse(to)-30*86400000).toISOString().slice(0,10);
   const metrics:{id:string;day:string;spend:number;impressions:number;clicks:number;conversions:number}[]=[];
   const attribution=account.platform==='meta'?'lead | 7d_click + 1d_view | impression_time':'Google conversions | configured attribution | interaction_date';
   if(account.platform==='google') {
    const batches=await googleRequest(token,`customers/${account.external_id}/googleAds:searchStream`,{query:`SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`});
    for(const batch of batches)for(const row of batch.results??[]) metrics.push({id:row.campaign.id,day:row.segments.date,spend:Number(row.metrics.costMicros??0)/1e6,impressions:Number(row.metrics.impressions??0),clicks:Number(row.metrics.clicks??0),conversions:Number(row.metrics.conversions??0)});
   } else {
    if(!process.env.META_API_VERSION)throw new AppError(422,'Configure META_API_VERSION.');
    const query=new URLSearchParams({fields:'campaign_id,date_start,spend,impressions,clicks,actions',level:'campaign',time_increment:'1',time_range:JSON.stringify({since:from,until:to}),action_attribution_windows:JSON.stringify(['7d_click','1d_view']),action_report_time:'impression',limit:'100'});
    let next:string|undefined=`https://graph.facebook.com/${process.env.META_API_VERSION}/${account.external_id}/insights?${query}`;
    while(next){if(new URL(next).hostname!=='graph.facebook.com')throw new AppError(502,'Paginação inválida.');const page=await providerJson(next,{headers:{Authorization:`Bearer ${token}`}});for(const row of page.data??[])metrics.push({id:row.campaign_id,day:row.date_start,spend:Number(row.spend??0),impressions:Number(row.impressions??0),clicks:Number(row.clicks??0),conversions:Number(row.actions?.find((a:any)=>a.action_type==='lead')?.value??0)});next=page.paging?.next;}
   }
   await transaction(async tx=>{
    // Replace a complete window atomically, including rows removed by provider corrections.
    await tx.query('DELETE FROM daily_metrics WHERE account_id=$1 AND day BETWEEN $2 AND $3 AND attribution=$4',[account.id,from,to,attribution]);
    for(const m of metrics)await tx.query('INSERT INTO daily_metrics(account_id,external_campaign_id,day,currency,timezone,attribution,spend,impressions,clicks,conversions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[account.id,m.id,m.day,account.currency,account.timezone,attribution,m.spend,m.impressions,m.clicks,m.conversions]);
    await tx.query("UPDATE sync_runs SET status='succeeded',completed_at=now() WHERE id=$1",[run.id]);
   });await syncDelivery(account,token);results.push({accountId:account.id,status:'succeeded'});
  } catch(error){const code=error instanceof AppError?String(error.status):'UNKNOWN';await db.query("UPDATE sync_runs SET status='failed',completed_at=now(),error=$2 WHERE id=$1",[run.id,code]);results.push({accountId:account.id,status:'failed'});}
 }
 return results;
}
