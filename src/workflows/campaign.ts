import { sleep } from 'workflow';
import { campaignAttempt } from './steps';

export async function campaignWorkflow(jobId:string) {
  'use workflow';
  // PostgreSQL owns attempts and backoff. Durable sleep releases the function.
  for(let i=0;i<20;i++) {
    const result=await campaignAttempt(jobId);
    if(!result.waitMs)return {status:result.status};
    await sleep(result.waitMs);
  }
  return {status:'recovery_required'};
}
