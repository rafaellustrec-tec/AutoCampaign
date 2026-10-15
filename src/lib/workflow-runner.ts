import { db } from './db';
import { claimJob,runClaimedJob } from './job-runner';

// This return value is persisted by Workflow. Never return credentials,
// briefing content, provider responses, or the lease token.
export async function workflowAttempt(id:string) {
  if(process.env.ADS_PUBLISH_ENABLED!=='true')return {status:'disabled',waitMs:0};
  const job=await claimJob(id);
  if(job)await runClaimedJob(job);
  const row=(await db.query("SELECT status,EXTRACT(EPOCH FROM (CASE WHEN status='running' THEN lease_until ELSE available_at END-now())) AS delay FROM jobs WHERE id=$1",[id])).rows[0];
  if(!row)return {status:'missing',waitMs:0};
  const waiting=['queued','running'].includes(row.status);
  return {status:row.status as string,waitMs:waiting?Math.max(1000,Math.min(610000,(Number(row.delay)+1)*1000)):0};
}
