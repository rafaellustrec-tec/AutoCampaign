import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from './db';
import type { User } from './auth';
import { requireRole } from './domain';
import { AppError } from './domain';
import { encrypt,decrypt,hash } from './security';
import { metaLoginUrl,exchangeMetaCode } from './meta-login';
import { googleLoginUrl,googleAccessibleAccounts,googleCustomerId } from './google-connection';
import { synchronizeAccounts } from './account-registry';
type Platform='meta'|'google';
type Connection={id:string;platform:Platform;credentials:string};
type Credentials={access_token:string;refresh_token?:string;expires_at:number};
const setting=(name:string)=>{const value=process.env[name];if(!value) throw new AppError(422,`Configure ${name} no servidor.`);return value;};
export async function providerJson(url:string,init?:RequestInit):Promise<any> {
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!response.ok) {
    const details=await response.json().catch(()=>({}));
    const auth=[401,403].includes(response.status)||details.error?.code===190;
    const limited=response.status===429||[4,17,32,613].includes(details.error?.code);
    throw new AppError(limited?429:auth||response.status===400?422:502,limited?'Limite da plataforma atingido.':auth?'Autorização insuficiente ou expirada. Reconecte a conta.':response.status===400?'Configuração rejeitada pela plataforma. Revise os campos e a elegibilidade da conta.':`Falha na plataforma (${response.status}).`);
  }
  return response.json();
}
const callback=(platform:Platform)=>`${setting('APP_URL')}/api/oauth/${platform}/callback`;
const metaSettings=()=>({appId:setting('META_APP_ID'),apiVersion:setting('META_API_VERSION'),configId:setting('META_LOGIN_CONFIG_ID'),redirectUri:callback('meta')});
export async function oauthStart(user:User,clientId:string|null,platform:Platform) {
  const state=randomBytes(32).toString('hex');
  const target=platform==='meta'?metaLoginUrl(metaSettings(),state):googleLoginUrl(setting('GOOGLE_CLIENT_ID'),callback(platform),state);
  if(platform==='google') {
    setting('GOOGLE_CLIENT_SECRET');setting('GOOGLE_ADS_DEVELOPER_TOKEN');
    if(!/^v\d+$/.test(setting('GOOGLE_ADS_API_VERSION')))throw new AppError(422,'Configure GOOGLE_ADS_API_VERSION, como v25.');
    if(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)googleCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  }
  await db.query("INSERT INTO oauth_states(state_hash,user_id,client_id,platform,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",[hash(state),user.id,clientId,platform]);
  return NextResponse.redirect(target);
}
export async function oauthCallback(request:Request,user:User,platform:Platform) {
  requireRole(user.role,[]);
  const url=new URL(request.url); const state=url.searchParams.get('state'); const code=url.searchParams.get('code');
  if(!state) throw new AppError(422,'Estado OAuth ausente.');
  const pending=(await db.query('DELETE FROM oauth_states WHERE state_hash=$1 AND user_id=$2 AND platform=$3 AND expires_at>now() RETURNING client_id',[hash(state),user.id,platform])).rows[0];
  if(!pending||!code||url.searchParams.has('error')) throw new AppError(422,'Autorização cancelada ou expirada. Inicie novamente.');
  let token;
  if(platform==='google') token=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:setting('GOOGLE_CLIENT_ID'),client_secret:setting('GOOGLE_CLIENT_SECRET'),redirect_uri:callback(platform),grant_type:'authorization_code'})});
  else {
    token=await exchangeMetaCode({...metaSettings(),appSecret:setting('META_APP_SECRET')},code,providerJson);
  }
  if(!token.access_token||(platform==='google'&&!token.refresh_token)) throw new AppError(422,'Credencial incompleta. Revogue e autorize novamente com consentimento offline.');
  const credentials:Credentials={access_token:token.access_token,refresh_token:token.refresh_token,expires_at:platform==='meta'?token.expires_at:Date.now()+Number(token.expires_in??3600)*1000};
  const connection=(await db.query('INSERT INTO connections(client_id,platform,credentials) VALUES($1,$2,$3) RETURNING id',[pending.client_id,platform,encrypt(JSON.stringify(credentials))])).rows[0];
  const destination=new URL(setting('APP_URL'));destination.searchParams.set('tab','connections');
  if(pending.client_id)destination.searchParams.set('client',pending.client_id);
  try{await synchronizeAccounts(user,connection.id,listRemoteAccounts);}catch{destination.searchParams.set('import','failed');}
  return NextResponse.redirect(destination);
}
export async function accessToken(connection:Connection) {
  const creds:Credentials=JSON.parse(decrypt(connection.credentials));
  if(creds.expires_at>Date.now()+60000) return creds.access_token;
  if(connection.platform==='meta'||!creds.refresh_token) {await db.query("UPDATE connections SET status='reconnect' WHERE id=$1",[connection.id]);throw new AppError(422,'Reconecte a conta para renovar a autorização.');}
  try {
    const fresh=await providerJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:setting('GOOGLE_CLIENT_ID'),client_secret:setting('GOOGLE_CLIENT_SECRET'),refresh_token:creds.refresh_token,grant_type:'refresh_token'})});
    creds.access_token=fresh.access_token;creds.expires_at=Date.now()+fresh.expires_in*1000;
    await db.query('UPDATE connections SET credentials=$2 WHERE id=$1',[connection.id,encrypt(JSON.stringify(creds))]); return creds.access_token;
  } catch(error) { if(error instanceof AppError&&error.status===422) await db.query("UPDATE connections SET status='reconnect' WHERE id=$1",[connection.id]); throw error; }
}
export async function googleRequest(token:string,path:string,body?:unknown,loginCustomerId?:string|null) {
  const headers:Record<string,string>={Authorization:`Bearer ${token}`,'developer-token':setting('GOOGLE_ADS_DEVELOPER_TOKEN'),'Content-Type':'application/json'};
  const manager=loginCustomerId===null?undefined:loginCustomerId??process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if(manager) headers['login-customer-id']=googleCustomerId(manager);
  return providerJson(`https://googleads.googleapis.com/${setting('GOOGLE_ADS_API_VERSION')}/${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
}
export async function listRemoteAccounts(connection:Connection) {
  const token=await accessToken(connection);
  const accounts:{externalId:string;name:string;currency:string;timezone:string}[]=[];
  if(connection.platform==='meta') {
    const visited=new Set<string>();
    let next:string|undefined=`https://graph.facebook.com/${setting('META_API_VERSION')}/me/adaccounts?fields=id,name,currency,timezone_name&limit=100`;
    while(next) {
      if(visited.has(next)||visited.size>=100)throw new AppError(502,'A importação não terminou. A lista salva foi preservada; tente novamente.');
      visited.add(next);
      const parsed=new URL(next); if(parsed.hostname!=='graph.facebook.com'||parsed.protocol!=='https:') throw new AppError(502,'Paginação inválida.');
      const page=await providerJson(next,{headers:{Authorization:`Bearer ${token}`}});
      for(const a of page.data??[]) accounts.push({externalId:a.id,name:a.name,currency:a.currency,timezone:a.timezone_name}); next=page.paging?.next;
    }
  } else {
    return googleAccessibleAccounts((path,body,manager)=>googleRequest(token,path,body,manager),process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  }
  return accounts;
}
