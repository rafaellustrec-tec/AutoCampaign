import { z } from 'zod';
export const uuid = z.string().uuid();
export const platformSchema = z.enum(['meta','google']);
export const briefingSchema = z.object({
  name:z.string().trim().min(3).max(160), offer:z.string().trim().min(3).max(3000),
  location:z.string().trim().min(2).max(300), startDate:z.iso.date(), endDate:z.iso.date(),
  channels:z.array(z.object({ platform:platformSchema, accountId:uuid, dailyBudget:z.number().positive().max(100000), destination:z.url().refine(v=>v.startsWith('https://'),'Utilize HTTPS'),
    kind:z.enum(['meta_form','meta_whatsapp','google_search']), conversionId:z.string().max(300).default(''),
    pageId:z.string().max(100).optional(), formId:z.string().max(100).optional(), whatsappNumber:z.string().max(30).optional(), whatsappMessage:z.string().max(300).default(''),
    keywords:z.array(z.string().min(1).max(80)).max(100).default([]), negatives:z.array(z.string().min(1).max(80)).max(100).default([]),
    assetIds:z.array(uuid).max(20).default([]),
    ageMin:z.number().int().min(18).max(65).default(18),ageMax:z.number().int().min(18).max(65).default(65),
    creativeVariants:z.array(z.object({id:uuid,assetId:uuid,title:z.string().trim().min(1).max(160),text:z.string().trim().min(3).max(3000)})).max(20).optional(),
    geoTargetId:z.string().regex(/^\d+$/,'Informe o ID geográfico oficial').optional(),
    metaCountry:z.string().regex(/^[A-Z]{2}$/,'Use o código de país, como BR').optional(),
    headlines:z.array(z.string().trim().min(1).max(30)).max(15).default([]),
    descriptions:z.array(z.string().trim().min(1).max(90)).max(4).default([])
  })).min(1).max(2)
}).superRefine((b,ctx)=>{
  if(b.endDate < b.startDate) ctx.addIssue({code:'custom',message:'Período inválido',path:['endDate']});
  if(new Set(b.channels.map(c=>c.platform)).size!==b.channels.length) ctx.addIssue({code:'custom',message:'Uma configuração por plataforma',path:['channels']});
  b.channels.forEach((c,i)=>{
    const fail=(message:string)=>ctx.addIssue({code:'custom',message,path:['channels',i]});
    if(c.ageMin>c.ageMax)fail('A idade mínima deve ser menor ou igual à máxima');
    if(c.creativeVariants?.length&&(c.platform!=='meta'||c.creativeVariants.some(v=>!c.assetIds.includes(v.assetId))||new Set(c.creativeVariants.map(v=>v.id)).size!==c.creativeVariants.length))fail('Variações devem usar imagens aprovadas e IDs únicos');
    if(c.platform==='google' && (c.kind!=='google_search'||!c.keywords.length||!c.conversionId)) fail('Pesquisa exige palavras-chave e conversão');
    if(c.platform==='meta' && (c.kind==='google_search'||!c.pageId||!c.assetIds.length)) fail('Meta exige página e material');
    if(c.kind==='meta_form'&&!c.formId) fail('Selecione formulário existente');
    if(c.kind==='meta_whatsapp'&&!c.whatsappNumber) fail('Informe WhatsApp elegível');
    if(c.platform==='google'&&!/^\d+$/.test(c.conversionId))fail('Informe uma conversão Google numérica');
    if(c.platform==='google'&&(!c.geoTargetId||new Set(c.headlines).size<3||new Set(c.descriptions).size<2)) fail('Pesquisa exige ID geográfico, três títulos distintos e duas descrições distintas');
    if(c.platform==='meta'&&(!c.geoTargetId||!c.metaCountry)) fail('Meta exige ID da cidade e código do país');
  });
});
export type Briefing = z.infer<typeof briefingSchema>;
export function whatsappDestination(phone:string,message='') {
  const digits=phone.replace(/[+\s().-]/g,'');
  if(!/^[1-9]\d{9,14}$/.test(digits))throw new Error('Informe WhatsApp com DDI e 10 a 15 dígitos.');
  return `https://wa.me/${digits}${message?`?text=${encodeURIComponent(message)}`:''}`;
}
export const whatsappBriefingSchema=briefingSchema.superRefine((b,ctx)=>{
  if(b.channels.length!==1||b.channels[0].platform!=='meta'||b.channels[0].kind!=='meta_whatsapp')ctx.addIssue({code:'custom',message:'Esta versão cria somente campanhas Meta para WhatsApp.',path:['channels']});
  b.channels.forEach((c,i)=>{
    if(!/^\d+$/.test(c.pageId??''))ctx.addIssue({code:'custom',message:'Informe o ID numérico da página.',path:['channels',i,'pageId']});
    try{if(c.destination!==whatsappDestination(c.whatsappNumber??'',c.whatsappMessage))throw new Error('Destino diferente do número/mensagem aprovados.');}
    catch(e){ctx.addIssue({code:'custom',message:(e as Error).message,path:['channels',i,'whatsappNumber']});}
  });
}).transform(b=>({...b,channels:b.channels.map(c=>({...c,whatsappNumber:c.whatsappNumber!.replace(/[+\s().-]/g,'')}))}));
// Supported production structures. The WhatsApp-only schema remains for its legacy form.
export const campaignBriefingSchema=briefingSchema.superRefine((b,ctx)=>{
 b.channels.forEach((c,i)=>{
  if(c.platform==='meta'){
   if(c.kind!=='meta_whatsapp')ctx.addIssue({code:'custom',message:'Meta aceita somente WhatsApp nesta entrega.',path:['channels',i,'kind']});
   if(!/^\d+$/.test(c.pageId??''))ctx.addIssue({code:'custom',message:'Informe a Página Meta.',path:['channels',i,'pageId']});
   try{if(c.destination!==whatsappDestination(c.whatsappNumber??'',c.whatsappMessage))throw Error('Destino não corresponde ao WhatsApp.');}catch(e){ctx.addIssue({code:'custom',message:(e as Error).message,path:['channels',i,'whatsappNumber']});}
  }
 });
}).transform(b=>({...b,channels:b.channels.map(c=>c.platform==='meta'?{...c,whatsappNumber:c.whatsappNumber!.replace(/[+\s().-]/g,'')}:c)}));
export const metaCreativeVariants=(c:Briefing['channels'][number],name:string,offer:string)=>c.creativeVariants?.length?c.creativeVariants:c.assetIds.map(assetId=>({id:assetId,assetId,title:name,text:offer}));
export type Role = 'admin'|'operator'|'approver';
export type CampaignStatus = 'draft'|'proposed'|'approved'|'creating'|'paused'|'activating'|'active'|'error';
export class AppError extends Error { constructor(public status:number,message:string) { super(message); } }
export function requireRole(role:Role, allowed:Role[]) { if(role!=='admin'&&!allowed.includes(role)) throw new AppError(403,'Seu perfil não permite esta ação.'); }
export function requireTransition(status:CampaignStatus, action:string) {
  const allowed:Record<string,CampaignStatus[]> = { propose:['draft','proposed','approved'], approve:['proposed'], create:['approved'], activate:['paused'], revise:['draft','proposed','approved'] };
  if(!allowed[action]?.includes(status)) throw new AppError(409,`Ação ${action} indisponível no estado ${status}.`);
}
export function makeProposal(briefing:Briefing) {
  return { source:'template', requiresReview:true, name:briefing.name, offer:briefing.offer, location:briefing.location,
    startDate:briefing.startDate,endDate:briefing.endDate,
    channels:briefing.channels.map(channel=>({...channel,headline:briefing.name,text:briefing.offer,status:'PAUSED',
      settings:channel.platform==='google'?{bidding:'MAXIMIZE_CONVERSIONS',conversionGoals:'ACCOUNT_DEFAULT',keywordMatch:'PHRASE',networks:'GOOGLE_SEARCH_ONLY',geoType:'PRESENCE',politicalAdvertising:false}:{objective:channel.kind==='meta_whatsapp'?'OUTCOME_ENGAGEMENT':'OUTCOME_LEADS',destination:channel.kind==='meta_whatsapp'?'WHATSAPP':'ON_AD',optimization:channel.kind==='meta_whatsapp'?'CONVERSATIONS':'LEAD_GENERATION',ageMin:channel.ageMin,ageMax:channel.ageMax,specialAdCategories:[],geoType:'CITY',bidStrategy:'LOWEST_COST_WITHOUT_CAP'}
    })) };
}
export function calculateKpis(spend:number,impressions:number,clicks:number,conversions:number) { return { spend,impressions,clicks,conversions,ctr:impressions?clicks/impressions*100:null,cpc:clicks?spend/clicks:null,cpa:conversions?spend/conversions:null }; }
