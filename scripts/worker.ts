import { db } from '../src/lib/db';
import { claimJob,runJob } from '../src/lib/job-runner';
let stop=false;process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
async function run() {
 while(!stop) {
  try {
   const job=await claimJob();
   if(job) {
     const result=await runJob(job);
     console.log(JSON.stringify({jobId:job.id,...result}));
   } else await new Promise(resolve=>setTimeout(resolve,2000));
  } catch(error) {console.error(error instanceof Error?error.message:'Worker indisponível');await new Promise(resolve=>setTimeout(resolve,5000));}
 }
 await db.end();
}
void run();
