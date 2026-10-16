import {z} from 'zod';
import {campaignBriefingSchema,whatsappDestination,type Briefing} from './domain';
const id=z.union([z.literal(''),z.string().uuid()]);
const text=(max:number)=>z.string().max(max).default('');
export const strategyDraftSchema=z.object({
 name:text(160),currency:z.enum(['BRL','USD','EUR','GBP','CAD','AUD']).default('BRL'),totalBudget:z.number().min(0).max(10000000).default(0),
 startDate:text(10),endDate:text(10),location:text(300),reviewEveryDays:z.number().int().min(1).max(30).default(7),reviewMaxCpa:z.number().min(0).max(1000000).default(0),reviewMinResults:z.number().int().min(1).max(100000).default(20),
 fronts:z.array(z.object({id:z.string().uuid(),name:text(80),allocation:z.number().min(0).max(100),
 meta:z.object({enabled:z.boolean(),accountId:id,pageId:text(100),phone:text(30),message:text(300),geoId:text(100),ageMin:z.number().int().min(18).max(65),ageMax:z.number().int().min(18).max(65),share:z.number().min(0).max(100),creatives:z.array(z.object({id:z.string().uuid(),assetId:id,title:text(160),text:text(3000)})).max(20)}),
 google:z.object({enabled:z.boolean(),accountId:id,landingPage:text(2048),conversionId:text(100),geoId:text(100),keywords:text(8000),negatives:text(8000),headlines:z.array(z.string().max(30)).max(15),descriptions:z.array(z.string().max(90)).max(4)})
 })).min(1).max(5)
}).superRefine((d,ctx)=>{if(new Set(d.fronts.map(f=>f.id)).size!==d.fronts.length)ctx.addIssue({code:'custom',message:'Frentes com identificadores repetidos.',path:['fronts']});for(const [i,f] of d.fronts.entries())if(new Set(f.meta.creatives.map(c=>c.id)).size!==f.meta.creatives.length)ctx.addIssue({code:'custom',message:'Criativos repetidos.',path:['fronts',i,'meta','creatives']});});
export type StrategyData=z.infer<typeof strategyDraftSchema>;
export type StrategyFront=StrategyData['fronts'][number];
export function newFront(name='Nova frente',allocation=100):StrategyFront{return {id:crypto.randomUUID(),name,allocation,meta:{enabled:true,accountId:'',pageId:'',phone:'',message:'Olá! Gostaria de saber mais.',geoId:'',ageMin:18,ageMax:65,share:50,creatives:[{id:crypto.randomUUID(),assetId:'',title:'',text:''}]},google:{enabled:false,accountId:'',landingPage:'',conversionId:'',geoId:'',keywords:'',negatives:'',headlines:['','',''],descriptions:['','']}};}
export function emptyStrategy():StrategyData{return {name:'Nova estratégia',currency:'BRL',totalBudget:0,startDate:'',endDate:'',location:'',reviewEveryDays:7,reviewMaxCpa:0,reviewMinResults:20,fronts:[newFront('Captação local')]};}
export const strategyModels=[{key:'local',name:'Captação local',description:'Uma oferta e uma frente para começar.',fronts:[['Captação local',100]]},{key:'clinic',name:'Clínica médica',description:'Consultas, procedimentos e institucional.',fronts:[['Consultas',50],['Procedimentos',35],['Institucional',15]]},{key:'custom',name:'Personalizado',description:'Monte as frentes da sua operação.',fronts:[['Nova frente',100]]}] as const;
export function periodDays(d:Pick<StrategyData,'startDate'|'endDate'>){if(!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(d.endDate))return 0;const days=(Date.parse(d.endDate)-Date.parse(d.startDate))/86400000+1;return Number.isInteger(days)&&days>=1&&days<=366?days:0;}
export function distributeCents(total:number,weights:number[]){
 const sum=weights.reduce((a,b)=>a+b,0);if(!sum)return weights.map(()=>0);
 const raw=weights.map(w=>total*w/sum),result=raw.map(Math.floor);let remainder=total-result.reduce((a,b)=>a+b,0);
 const order=raw.map((v,i)=>({i,rest:v-result[i]})).sort((a,b)=>b.rest-a.rest||a.i-b.i);for(let n=0;n<remainder;n++)result[order[n%order.length].i]++;return result;
}
export function strategyBudget(d:StrategyData){const cents=distributeCents(Math.round(d.totalBudget*100),d.fronts.map(f=>f.allocation)),days=periodDays(d);return d.fronts.map((front,i)=>{const shares=front.meta.enabled&&front.google.enabled?[front.meta.share,100-front.meta.share]:[front.meta.enabled?100:0,front.google.enabled?100:0];const [meta,google]=distributeCents(cents[i],shares);return {id:front.id,total:cents[i]/100,meta:meta/100,google:google/100,metaDaily:days?Math.floor(meta/days)/100:0,googleDaily:days?Math.floor(google/days)/100:0};});}
export function strategyIssues(d:StrategyData,step=4){
 const errors:Record<string,string>={};const set=(key:string,message:string)=>{errors[key]??=message;};
 if(d.name.trim().length<3)set('name','Dê um nome de pelo menos 3 caracteres à estratégia.');
 if(step>=1){if(!periodDays(d))set('dates','Defina um período válido de até 366 dias.');if(d.location.trim().length<2)set('location','Informe a cidade ou região.');if(!d.totalBudget)set('totalBudget','Informe o investimento planejado.');if(Math.abs(d.fronts.reduce((s,f)=>s+f.allocation,0)-100)>0.00001)set('allocation','A distribuição das frentes deve somar 100%.');}
 const budget=strategyBudget(d);
 d.fronts.forEach((f,i)=>{
  const prefix=`fronts.${i}`;if(!f.meta.enabled&&!f.google.enabled)set(prefix+'.channels','Escolha pelo menos um canal.');
  if(step>=1&&f.meta.enabled&&!f.meta.accountId)set(prefix+'.meta.accountId','Selecione uma conta Meta vinculada.');if(step>=1&&f.google.enabled&&!f.google.accountId)set(prefix+'.google.accountId','Selecione uma conta Google vinculada.');
  if(step>=1){if(!f.name.trim())set(prefix+'.name','Nomeie esta frente.');if(!f.allocation)set(prefix+'.allocation','Reserve uma parcela do investimento para esta frente.');
   if(f.meta.enabled){if(!/^\d+$/.test(f.meta.pageId))set(prefix+'.meta.pageId','Informe o ID real da Página.');try{const phone=f.meta.phone.replace(/\D/g,'');if(!phone.startsWith('55')||phone.length<12||phone.length>13)throw Error();whatsappDestination(f.meta.phone,f.meta.message);}catch{set(prefix+'.meta.phone','Use o WhatsApp brasileiro com DDI 55.');}if(!/^\d+$/.test(f.meta.geoId))set(prefix+'.meta.geoId','Informe a cidade oficial da Meta.');if(f.meta.ageMin>f.meta.ageMax)set(prefix+'.meta.ageMin','A idade mínima não pode superar a máxima.');if(budget[i].metaDaily<0.01)set(prefix+'.meta.share','A parcela Meta é insuficiente para o período.');}
   if(f.google.enabled){if(!/^https:\/\//.test(f.google.landingPage))set(prefix+'.google.landingPage','Informe uma landing page HTTPS.');if(!/^\d+$/.test(f.google.conversionId))set(prefix+'.google.conversionId','Informe uma conversão principal da conta.');if(!/^\d+$/.test(f.google.geoId))set(prefix+'.google.geoId','Informe a localização oficial do Google.');if(budget[i].googleDaily<0.01)set(prefix+'.meta.share','A parcela Google é insuficiente para o período.');}
  }
  if(step>=2){if(f.meta.enabled)f.meta.creatives.forEach((c,n)=>{if(!c.assetId)set(prefix+`.meta.creatives.${n}.assetId`,'Escolha uma imagem disponível.');if(c.title.trim().length<1)set(prefix+`.meta.creatives.${n}.title`,'Informe o título.');if(c.text.trim().length<3)set(prefix+`.meta.creatives.${n}.text`,'Informe o texto do anúncio.');});
   if(f.meta.enabled&&!f.meta.creatives.length)set(prefix+'.meta.creatives','Adicione pelo menos um criativo.');
   if(f.google.enabled){if(!f.google.keywords.trim())set(prefix+'.google.keywords','Informe as palavras-chave, uma por linha.');if(new Set(f.google.headlines.filter(h=>h.trim())).size<3)set(prefix+'.google.headlines','Escreva pelo menos 3 títulos diferentes, com até 30 caracteres.');if(new Set(f.google.descriptions.filter(h=>h.trim())).size<2)set(prefix+'.google.descriptions','Escreva pelo menos 2 descrições diferentes, com até 90 caracteres.');}
  }
 });return errors;
}
export function strategyBriefings(d:StrategyData){const errors=strategyIssues(d);if(Object.keys(errors).length)throw Error(Object.values(errors).join(' '));const budget=strategyBudget(d);const output:{frontId:string;platform:'meta'|'google';briefing:Briefing}[]=[];
 const lines=(v:string)=>[...new Set(v.split('\n').map(s=>s.trim()).filter(Boolean))];
 d.fronts.forEach((f,i)=>{const common={name:`${d.name} · ${f.name}`.slice(0,160),location:d.location,startDate:d.startDate,endDate:d.endDate,offer:f.meta.creatives[0]?.text||f.google.descriptions[0]||f.name};
  if(f.meta.enabled)output.push({frontId:f.id,platform:'meta',briefing:campaignBriefingSchema.parse({...common,channels:[{platform:'meta',kind:'meta_whatsapp',accountId:f.meta.accountId,dailyBudget:budget[i].metaDaily,destination:whatsappDestination(f.meta.phone,f.meta.message),whatsappNumber:f.meta.phone,whatsappMessage:f.meta.message,pageId:f.meta.pageId,geoTargetId:f.meta.geoId,metaCountry:'BR',ageMin:f.meta.ageMin,ageMax:f.meta.ageMax,assetIds:[...new Set(f.meta.creatives.map(c=>c.assetId))],creativeVariants:f.meta.creatives.map(c=>({id:c.id,assetId:c.assetId,title:c.title,text:c.text}))}]})});
  if(f.google.enabled)output.push({frontId:f.id,platform:'google',briefing:campaignBriefingSchema.parse({...common,offer:f.google.descriptions[0]||f.name,channels:[{platform:'google',kind:'google_search',accountId:f.google.accountId,dailyBudget:budget[i].googleDaily,destination:f.google.landingPage,conversionId:f.google.conversionId,geoTargetId:f.google.geoId,keywords:lines(f.google.keywords),negatives:lines(f.google.negatives),headlines:f.google.headlines.map(t=>t.trim()).filter(Boolean),descriptions:f.google.descriptions.map(t=>t.trim()).filter(Boolean)}]})});
 });return output;
}
