import { workflowAttempt } from '../lib/workflow-runner';
export async function campaignAttempt(jobId:string) {
  'use step';
  return workflowAttempt(jobId);
}
