import { secretMatches } from '@/lib/security';
import { recoverWorkflows } from '@/lib/workflow-dispatch';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<32||!secretMatches(request.headers.get('authorization')??'',`Bearer ${secret}`))return Response.json({error:'Não autorizado.'},{status:401});
  try{return Response.json({dispatched:await recoverWorkflows()});}
  catch{return Response.json({error:'Falha na recuperação de execuções.'},{status:503});}
}
