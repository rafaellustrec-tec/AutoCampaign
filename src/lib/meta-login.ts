import { AppError } from './domain';

type Settings = { appId:string; apiVersion:string; configId:string; redirectUri:string };
type JsonRequest = (url:string, init?:RequestInit)=>Promise<any>;

export function metaLoginUrl(settings:Settings, state:string) {
  if(!/^\d+$/.test(settings.appId)||!/^\d+$/.test(settings.configId)||!/^v\d+\.\d+$/.test(settings.apiVersion)) {
    throw new AppError(422,'Configure META_APP_ID, META_LOGIN_CONFIG_ID e META_API_VERSION no servidor.');
  }
  const url=new URL(`https://www.facebook.com/${settings.apiVersion}/dialog/oauth`);
  url.search=new URLSearchParams({client_id:settings.appId,config_id:settings.configId,redirect_uri:settings.redirectUri,state,response_type:'code',override_default_response_type:'true'}).toString();
  // Permissions and assets come from the Business Login configuration.
  return url;
}

export function metaTokenExpiry(data:any, appId:string, now=Date.now()) {
  if(data?.is_valid!==true||String(data.app_id)!==appId||data.type!=='SYSTEM_USER'||!Array.isArray(data.scopes)||!data.scopes.includes('ads_management')) {
    throw new AppError(422,'A Meta não confirmou um token de usuário do sistema deste aplicativo com ads_management. Revise a configuração e autorize novamente.');
  }
  // Never assume 60 days or accept an unconfirmed/non-expiring token in this pilot.
  const expiry=Number(data.expires_at);
  const accessExpiry=Number(data.data_access_expires_at??0);
  if(!Number.isSafeInteger(expiry)||expiry<=0||!Number.isFinite(accessExpiry)||accessExpiry<0)throw new AppError(422,'A Meta não informou uma validade segura para o token.');
  const expiresAt=Math.min(expiry,accessExpiry>0?accessExpiry:expiry)*1000;
  if(expiresAt<=now+60000)throw new AppError(422,'A autorização Meta está expirada ou próxima do vencimento. Reconecte a conta.');
  return expiresAt;
}

export async function exchangeMetaCode(settings:Settings & {appSecret:string}, code:string, request:JsonRequest) {
  const base=`https://graph.facebook.com/${settings.apiVersion}`;
  const token=await request(`${base}/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:settings.appId,client_secret:settings.appSecret,redirect_uri:settings.redirectUri,code})});
  if(typeof token.access_token!=='string'||!token.access_token)throw new AppError(422,'A Meta não retornou um token. Autorize novamente.');
  // A Business Login system-user token must not undergo the personal-user long-lived exchange.
  const debug=new URL(`${base}/debug_token`);
  debug.searchParams.set('input_token',token.access_token);
  const inspected=await request(debug.toString(),{headers:{Authorization:`Bearer ${settings.appId}|${settings.appSecret}`}});
  return {access_token:token.access_token,expires_at:metaTokenExpiry(inspected.data,settings.appId)};
}
