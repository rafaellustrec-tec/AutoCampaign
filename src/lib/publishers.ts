import { db,transaction } from './db';
import { requireActivationEnabled,requireCreationAllowed } from './publication-policy';
import { AppError,campaignBriefingSchema,metaCreativeVariants,type Briefing,whatsappDestination } from './domain';
import { accessToken,googleRequest,providerJson } from './oauth';
import { assetBytes } from './storage';
type Channel=Briefing['channels'][number];
type Job={id:string;client_id:string;campaign_id:string;version:number;kind:string;lease_token:string};
type Account={id:string;external_id:string;currency:string;timezone:string;platform:'meta'|'google';connection_id:string;credentials:string};
type External={key:string;id:string;kind:string;status?:string};
const metaVersion=()=>{if(!/^v\d+\.\d+$/.test(process.env.META_API_VERSION??''))throw new AppError(422,'Configure META_API_VERSION.');return process.env.META_API_VERSION;};
async function meta(token:string,path:string,body?:Record<string,unknown>) {
  if(body?.status==='ACTIVE')requireActivationEnabled('activate');
  const form=new URLSearchParams();for(const [k,v] of Object.entries(body??{}))form.set(k,typeof v==='string'?v:JSON.stringify(v));
  return providerJson(`https://graph.facebook.com/${metaVersion()}/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?form:undefined});
}
// Write intent before network I/O. Unknown outcomes are never automatically replayed.
export async function operation(job:Job,account:Account,key:string,fn:()=>Promise<External[]>):Promise<External[]> {
  const reservation=await transaction(async tx=>{
    const lease=await tx.query("SELECT 1 FROM jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>now() FOR UPDATE",[job.id,job.lease_token]);if(!lease.rowCount)throw new AppError(409,'Execução expirada.');
    const row=(await tx.query('SELECT * FROM provider_operations WHERE campaign_id=$1 AND version=$2 AND account_id=$3 AND operation_key=$4 FOR UPDATE',[job.campaign_id,job.version,account.id,key])).rows[0];
    if(row){if(row.state==='succeeded')return row.result as External[];throw new AppError(409,'Resultado externo ambíguo. Reconciliação manual necessária.');}
    await tx.query("INSERT INTO provider_operations(campaign_id,version,account_id,operation_key,state) VALUES($1,$2,$3,$4,'in_flight')",[job.campaign_id,job.version,account.id,key]);return null;
  });
  if(reservation)return reservation;
  try {
    const result=await fn();
    await transaction(async tx=>{
      for(const object of result)await tx.query('INSERT INTO external_objects(campaign_id,version,account_id,object_key,external_id,kind,delivery_status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(campaign_id,version,account_id,object_key) DO UPDATE SET delivery_status=EXCLUDED.delivery_status',[job.campaign_id,job.version,account.id,object.key,object.id,object.kind,object.status??'PAUSED']);
      await tx.query("UPDATE provider_operations SET state='succeeded',result=$5,updated_at=now() WHERE campaign_id=$1 AND version=$2 AND account_id=$3 AND operation_key=$4",[job.campaign_id,job.version,account.id,key,JSON.stringify(result)]);
    });return result;
  } catch(error) {await db.query("UPDATE provider_operations SET state='ambiguous',updated_at=now() WHERE campaign_id=$1 AND version=$2 AND account_id=$3 AND operation_key=$4",[job.campaign_id,job.version,account.id,key]);throw error;}
}
export function googleCreatePayload(briefing:Briefing,c:Channel,customer:string,marker:string) {
 const root=`customers/${customer}`;const budget=`${root}/campaignBudgets/-1`;const campaign=`${root}/campaigns/-2`;const group=`${root}/adGroups/-3`;
 const operations:any[]=[
  {campaignBudgetOperation:{create:{resourceName:budget,name:`${marker} / verba`,amountMicros:String(Math.round(c.dailyBudget*1000000)),deliveryMethod:'STANDARD',explicitlyShared:false}}},
  {campaignOperation:{create:{resourceName:campaign,name:`${briefing.name} [${marker}]`,status:'PAUSED',advertisingChannelType:'SEARCH',campaignBudget:budget,maximizeConversions:{},startDate:briefing.startDate.replaceAll('-',''),endDate:briefing.endDate.replaceAll('-',''),networkSettings:{targetGoogleSearch:true,targetSearchNetwork:false,targetContentNetwork:false},geoTargetTypeSetting:{positiveGeoTargetType:'PRESENCE'},containsEuPoliticalAdvertising:'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'}}},
  {adGroupOperation:{create:{resourceName:group,name:`${marker} / principal`,campaign,status:'PAUSED',type:'SEARCH_STANDARD'}}},
  {campaignCriterionOperation:{create:{campaign,location:{geoTargetConstant:`geoTargetConstants/${c.geoTargetId}`}}}},
  ...c.keywords.map(text=>({adGroupCriterionOperation:{create:{adGroup:group,status:'ENABLED',keyword:{text,matchType:'PHRASE'}}}})),
  ...c.negatives.map(text=>({campaignCriterionOperation:{create:{campaign,negative:true,keyword:{text,matchType:'PHRASE'}}}})),
  {adGroupAdOperation:{create:{adGroup:group,status:'PAUSED',ad:{finalUrls:[c.destination],responsiveSearchAd:{headlines:c.headlines.map(text=>({text})),descriptions:c.descriptions.map(text=>({text}))}}}}}
 ];
 return {mutateOperations:operations,partialFailure:false};
}
async function createGoogle(job:Job,account:Account,briefing:Briefing,c:Channel,token:string) {
 const customer=account.external_id.replaceAll('-','');const marker=`orbita-${job.campaign_id}-v${job.version}`;
 const payload=googleCreatePayload(briefing,c,customer,marker);
 const conversion=await googleRequest(token,`customers/${customer}/googleAds:searchStream`,{query:`SELECT conversion_action.id, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.id = ${c.conversionId}`});
 if(!conversion.some((b:any)=>b.results?.some((r:any)=>r.conversionAction.status==='ENABLED'&&r.conversionAction.primaryForGoal)))throw new AppError(422,'A conversão deve estar ativa e ser principal nos objetivos da conta.');
 // Validate before reserving a mutation; validation has no external side effects.
 await googleRequest(token,`customers/${customer}/googleAds:mutate`,{...payload,validateOnly:true});
 await operation(job,account,'google-structure',async()=>{
   const result=await googleRequest(token,`customers/${customer}/googleAds:mutate`,payload);
   const objects:External[]=[];
   for(const [index,item] of result.mutateOperationResponses.entries()){
     for(const [kind,value] of Object.entries(item) as [string,any][]){const type=kind.replace('Result','');const map:Record<string,string>={campaignBudget:'budget',campaign:'campaign',adGroup:'adgroup',adGroupAd:'ad',campaignCriterion:'criterion',adGroupCriterion:'criterion'};if(value.resourceName)objects.push({key:`google-${index}`,id:value.resourceName,kind:map[type]??'criterion'});}
   }return objects;
 });
}
function minorUnits(value:number,currency:string){if(!['BRL','USD','EUR','GBP','CAD','AUD'].includes(currency))throw new AppError(422,'Certifique a unidade monetária desta conta Meta antes de publicar.');return Math.round(value*100);}
export function accountTimestamp(date:string,time:string,timezone:string) {
 const target=Date.parse(`${date}T${time}Z`);let value=target;
 const parts=(epoch:number)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch)).map(p=>[p.type,p.value]));
 for(let i=0;i<3;i++){const p=parts(value);const actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);if(actual===target)return String(value/1000);value+=target-actual;}
 throw new AppError(422,'Horário inexistente no fuso da conta. Ajuste o período.');
}
export function metaWhatsAppPayloads(briefing:Briefing,c:Channel,currency:string,timezone:string,marker:string) {
 const link=whatsappDestination(c.whatsappNumber??'',c.whatsappMessage);
 return {
  campaign:{name:`${briefing.name} [${marker}]`,objective:'OUTCOME_ENGAGEMENT',status:'PAUSED',special_ad_categories:[]},
  adset:{name:`${marker} / WhatsApp`,status:'PAUSED',daily_budget:minorUnits(c.dailyBudget,currency),billing_event:'IMPRESSIONS',optimization_goal:'CONVERSATIONS',destination_type:'WHATSAPP',bid_strategy:'LOWEST_COST_WITHOUT_CAP',start_time:accountTimestamp(briefing.startDate,'00:00:00',timezone),end_time:accountTimestamp(briefing.endDate,'23:59:59',timezone),promoted_object:{page_id:c.pageId},targeting:{geo_locations:{cities:[{key:c.geoTargetId}]},age_min:c.ageMin??18,age_max:c.ageMax??65}},
  linkData:{link,message:briefing.offer,name:briefing.name,call_to_action:{type:'WHATSAPP_MESSAGE',value:{app_destination:'WHATSAPP',link,whatsapp_number:c.whatsappNumber}}},
 };
}
async function createMeta(job:Job,account:Account,briefing:Briefing,c:Channel,token:string) {
 const marker=`orbita-${job.campaign_id}-v${job.version}`;const act=account.external_id.startsWith('act_')?account.external_id:`act_${account.external_id}`;
 const assets=(await db.query("SELECT id,content_type,size FROM assets WHERE client_id=$1 AND id=ANY($2::uuid[]) AND status='ready'",[job.client_id,c.assetIds])).rows;
 if(assets.length!==new Set(c.assetIds).size||assets.some(a=>a.content_type==='video/mp4'))throw new AppError(422,'Utilize imagens disponíveis no piloto; publicação de vídeo requer certificação adicional.');
 if(assets.some(a=>Number(a.size)>30*1024*1024))throw new AppError(422,'Imagem acima do limite do piloto (30 MB).');
 if(!/^\d+$/.test(c.pageId??'')||!/^\d+$/.test(c.geoTargetId??''))throw new AppError(422,'IDs Meta inválidos.');
 const page=await meta(token,`${c.pageId}?fields=id,name,whatsapp_number`);if(!page.id)throw new AppError(422,'Página não acessível.');
 if(!page.whatsapp_number||String(page.whatsapp_number).replace(/\D/g,'')!==c.whatsappNumber)throw new AppError(422,'O WhatsApp informado não está confirmado como vinculado a esta página.');
 if(c.kind==='meta_form'){if(!/^\d+$/.test(c.formId??''))throw new AppError(422,'ID de formulário inválido.');const form=await meta(token,`${c.formId}?fields=id,status,page`);if(form.page?.id!==c.pageId||form.status!=='ACTIVE')throw new AppError(422,'Formulário indisponível ou de outra página.');}
 const payloads=metaWhatsAppPayloads(briefing,c,account.currency,account.timezone,marker);
 const [campaign]=await operation(job,account,'meta-campaign',async()=>{const result=await meta(token,`${act}/campaigns`,payloads.campaign);return [{key:'meta-campaign',id:result.id,kind:'campaign'}];});
 const [adset]=await operation(job,account,'meta-adset',async()=>{const result=await meta(token,`${act}/adsets`,{...payloads.adset,campaign_id:campaign.id});return [{key:'meta-adset',id:result.id,kind:'adset'}];});
 for(const variant of metaCreativeVariants(c,briefing.name,briefing.offer)) {
   const assetId=variant.assetId;const variantKey=variant.id;
   const asset=(await db.query("SELECT * FROM assets WHERE id=$1 AND client_id=$2 AND status='ready'",[assetId,job.client_id])).rows[0];if(!asset)throw new AppError(422,'Material não disponível.');
   if(asset.content_type==='video/mp4')throw new AppError(422,'Publicação de vídeo exige certificação do processamento assíncrono; utilize imagem no piloto.');
   const [image]=await operation(job,account,`meta-image-${assetId}`,async()=>{const bytes=await assetBytes(asset.storage_key);const result=await meta(token,`${act}/adimages`,{bytes:Buffer.from(bytes).toString('base64')});const value=Object.values(result.images??{})[0] as {hash:string}|undefined;if(!value?.hash)throw new AppError(502,'Upload de imagem não confirmado.');return [{key:`meta-image-${assetId}`,id:value.hash,kind:'asset'}];});
   const [creative]=await operation(job,account,`meta-creative-${variantKey}`,async()=>{const result=await meta(token,`${act}/adcreatives`,{name:`${marker} / ${assetId}`,object_story_spec:{page_id:c.pageId,link_data:{...payloads.linkData,name:variant.title,message:variant.text,image_hash:image.id}}});return [{key:`meta-creative-${variantKey}`,id:result.id,kind:'creative'}];});
   await operation(job,account,`meta-ad-${variantKey}`,async()=>{const result=await meta(token,`${act}/ads`,{name:`${marker} / ${asset.name}`,adset_id:adset.id,creative:{creative_id:creative.id},status:'PAUSED'});return [{key:`meta-ad-${variantKey}`,id:result.id,kind:'ad'}];});
 }
}
export async function executePublication(job:Job) {
 if(job.kind==='create')requireCreationAllowed(job.campaign_id);
 requireActivationEnabled(job.kind);
 if(process.env.ADS_PUBLISH_ENABLED!=='true')throw new AppError(422,'Publicação externa desabilitada.');
 const version=(await db.query('SELECT briefing FROM campaign_versions WHERE campaign_id=$1 AND version=$2',[job.campaign_id,job.version])).rows[0];const briefing=campaignBriefingSchema.parse(version.briefing);
 for(const c of briefing.channels) {
  const account=(await db.query("SELECT a.*,co.credentials FROM ad_accounts a JOIN connections co ON co.id=a.connection_id WHERE a.id=$1 AND a.client_id=$2 AND a.available AND co.status='connected'",[c.accountId,job.client_id])).rows[0] as Account|undefined;if(!account)throw new AppError(422,'Conta desconectada.');
  const token=await accessToken({id:account.connection_id,platform:account.platform,credentials:account.credentials});
  try {
    if(job.kind==='create'){if(account.platform==='meta')await createMeta(job,account,briefing,c,token);else await createGoogle(job,account,briefing,c,token);}
    else if(job.kind==='activate')await activate(job,account,token);
    else throw new AppError(422,'Tipo de tarefa não suportado.');
  }catch(error){
    if(error instanceof AppError&&error.message.includes('Reconecte'))await db.query("UPDATE connections SET status='reconnect' WHERE id=$1",[account.connection_id]);
    throw error;
  }
 }
}
async function activate(job:Job,account:Account,token:string) {
 requireActivationEnabled('activate');
 const objects=(await db.query('SELECT * FROM external_objects WHERE campaign_id=$1 AND version=$2 AND account_id=$3',[job.campaign_id,job.version,account.id])).rows;
 if(account.platform==='google') {
  const campaign=objects.find(o=>o.kind==='campaign');if(!campaign)throw new AppError(409,'Campanha externa ausente.');
  await operation(job,account,'google-activate',async()=>{requireActivationEnabled('activate');const serving=objects.filter(o=>['adgroup','ad','campaign'].includes(o.kind));const mutateOperations=serving.sort((a,b)=>Number(a.kind==='campaign')-Number(b.kind==='campaign')).map(o=>({[o.kind==='campaign'?'campaignOperation':o.kind==='adgroup'?'adGroupOperation':'adGroupAdOperation']:{update:{resourceName:o.external_id,status:'ENABLED'},updateMask:'status'}}));await googleRequest(token,`customers/${account.external_id}/googleAds:mutate`,{mutateOperations,partialFailure:false});return serving.map(o=>({key:o.object_key,id:o.external_id,kind:o.kind,status:'ACTIVE'}));});
 } else {
  for(const kind of ['ad','adset','campaign'])for(const object of objects.filter(o=>o.kind===kind))await operation(job,account,`activate-${object.object_key}`,async()=>{await meta(token,object.external_id,{status:'ACTIVE'});return [{key:object.object_key,id:object.external_id,kind,status:'ACTIVE'}];});
 }
}
