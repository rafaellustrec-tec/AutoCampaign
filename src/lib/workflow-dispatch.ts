import { db } from './db';

export async function dispatchCampaignJob(campaignId:string,kind:string,version:number) {
  if(process.env.JOB_EXECUTOR!=='vercel')return;
  const row=(await db.query('SELECT id FROM jobs WHERE campaign_id=$1 AND kind=$2 AND version=$3',[campaignId,kind,version])).rows[0];
  if(row)await dispatchWorkflow(row.id);
}
export async function dispatchWorkflow(id:string) {
  const {start}=await import('workflow/api');
  const {campaignWorkflow}=await import('../workflows/campaign');
  await start(campaignWorkflow,[id]);
}
export async function recoverWorkflows() {
  if(process.env.JOB_EXECUTOR!=='vercel'||process.env.ADS_PUBLISH_ENABLED!=='true')return 0;
  const rows=(await db.query("SELECT id FROM jobs WHERE (status='queued' AND available_at<=now()) OR (status='running' AND lease_until<now()) ORDER BY created_at LIMIT 20")).rows;
  for(const row of rows)await dispatchWorkflow(row.id);
  return rows.length;
}
