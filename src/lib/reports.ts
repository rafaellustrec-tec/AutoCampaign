import { PDFDocument,StandardFonts,rgb } from 'pdf-lib';
import { db } from './db';
import { calculateKpis } from './domain';
import { z } from 'zod';
import { assetBytes } from './storage';
import { AppError } from './domain';
export const reportConfigSchema=z.object({brand:z.string().min(1).max(60).default('Agency OS'),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#24634e'),blocks:z.array(z.enum(['spend','traffic','conversions','comparison'])).min(1).default(['spend','traffic','conversions','comparison']),logoAssetId:z.string().uuid().optional()});
export type ReportConfig=z.infer<typeof reportConfigSchema>;
export async function reportLogo(clientId:string,assetId?:string){if(!assetId)return undefined;const asset=(await db.query("SELECT storage_key,content_type FROM assets WHERE id=$1 AND client_id=$2 AND status='ready' AND content_type IN ('image/png','image/jpeg')",[assetId,clientId])).rows[0];if(!asset)throw new AppError(422,'Logo deve ser PNG ou JPEG disponível neste cliente.');return {bytes:await assetBytes(asset.storage_key),type:asset.content_type};}
export async function reportData(clientId:string,from:string,to:string) {
  const client=(await db.query('SELECT name FROM clients WHERE id=$1',[clientId])).rows[0];
  const days=Math.floor((Date.parse(to)-Date.parse(from))/86400000)+1;
  const previousTo=new Date(Date.parse(from)-86400000).toISOString().slice(0,10);
  const previousFrom=new Date(Date.parse(from)-days*86400000).toISOString().slice(0,10);
  async function collect(start:string,end:string) {
    const rows=(await db.query(`SELECT a.platform,m.currency,m.timezone,m.attribution,SUM(m.spend)::float AS spend,SUM(m.impressions)::float AS impressions,SUM(m.clicks)::float AS clicks,SUM(m.conversions)::float AS conversions,MAX(m.updated_at) AS updated_at FROM daily_metrics m JOIN ad_accounts a ON a.id=m.account_id WHERE a.client_id=$1 AND m.day BETWEEN $2 AND $3 GROUP BY a.platform,m.currency,m.timezone,m.attribution ORDER BY a.platform,m.currency,m.timezone,m.attribution`,[clientId,start,end])).rows;
    return rows.map(row=>({...row,...calculateKpis(row.spend,row.impressions,row.clicks,row.conversions)}));
  }
  return {client:client.name,from,to,previousFrom,previousTo,current:await collect(from,to),previous:await collect(previousFrom,previousTo)};
}
export async function reportPdf(data:Awaited<ReturnType<typeof reportData>>,brand:string,config:ReportConfig=reportConfigSchema.parse({brand}),logo?:{bytes:Uint8Array;type:string}) {
  const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe=(value:string)=>value.replace(/[^\x20-\x7E\xA0-\xFF]/g,' ');
  let page=pdf.addPage([595.28,841.89]);let y=780;
  const color=rgb(parseInt(config.color.slice(1,3),16)/255,parseInt(config.color.slice(3,5),16)/255,parseInt(config.color.slice(5,7),16)/255);
  page.drawRectangle({x:0,y:825,width:595.28,height:17,color});
  if(logo){try{const image=logo.type==='image/png'?await pdf.embedPng(logo.bytes):await pdf.embedJpg(logo.bytes);const scaled=image.scaleToFit(110,45);page.drawImage(image,{x:440,y:755,width:scaled.width,height:scaled.height});}catch{throw new AppError(422,'O arquivo selecionado não é uma imagem de logo válida.');}}
  const line=(text:string,size=11,strong=false)=>{if(y<60){page=pdf.addPage([595.28,841.89]);y=780;}page.drawText(safe(text).slice(0,95),{x:45,y,size,font:strong?bold:font,color:rgb(.1,.15,.25)});y-=size+12;};
  line(brand.slice(0,60),13,true);line('Relatório de performance',24,true);line(data.client,18,true);line(`${data.from} a ${data.to}`);if(config.blocks.includes('comparison'))line(`Comparação: ${data.previousFrom} a ${data.previousTo}`);
  if(!data.current.length) line('Sem dados sincronizados para este período.');
  for(const row of data.current) {
    y-=15;line(`${row.platform.toUpperCase()} | ${row.currency} | ${row.timezone}`,13,true);line(`Atribuição: ${row.attribution}`);
    if(config.blocks.includes('spend'))line(`Investimento: ${row.spend.toFixed(2)} ${row.currency}`);
    if(config.blocks.includes('traffic'))line(`Impressões: ${row.impressions} | Cliques: ${row.clicks} | CTR: ${row.ctr?.toFixed(2)??'--'}%`);
    if(config.blocks.includes('conversions'))line(`Conversões da plataforma: ${row.conversions} | CPA: ${row.cpa?.toFixed(2)??'--'}`);
    const prev=data.previous.find(p=>p.platform===row.platform&&p.currency===row.currency&&p.timezone===row.timezone&&p.attribution===row.attribution);
    if(config.blocks.includes('comparison'))line(prev?`Período anterior: investimento ${prev.spend.toFixed(2)} | conversões ${prev.conversions}`:'Sem dados comparáveis no período anterior.');
  }
  line('Conversões entre canais podem se sobrepor. Não representam leads únicos.',9);
  return Buffer.from(await pdf.save());
}
