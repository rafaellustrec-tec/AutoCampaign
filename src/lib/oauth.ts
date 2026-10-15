import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from './db';
import type { User } from './auth';
import { requireRole } from './domain';
import { AppError } from './domain';
import { encrypt,decrypt,hash } from './security';
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
export async function oauthStart(user:User,clientId:string,platform:Platform) {
  const state=randomBytes(32).toString('hex');
  const target=platform==='google'?new URL('https://accounts.google.com/o/oauth2/v2/auth'):new URL(`https://www.facebook.com/${setting('META_API_VERSION')}/dialog/oauth`);
  target.searchParams.set('client_id',setting(platform==='google'?'GOOGLE_CLIENT_ID':'META_APP_ID'));
  target.searchParams.set('redirect_uri',callback(platform)); target.searchParams.set('state',state);target.searchParams.set('response_type','code');
  target.searchParams.set('scope',platform==='google'?'https://www.googleapis.com/auth/adwords':'ads_read,ads_management,business_management,pages_show_list,pages_read_engagement');
  if(platform==='google') {target.searchParams.set('access_type','offline');target.searchParams.set('prompt','consent');}
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
    const endpoint=`https://graph.facebook.com/${setting('META_API_VERSION')}/oauth/access_token`;
    const query=new URLSearchParams({code,client_id:setting('META_APP_ID'),client_secret:setting('META_APP_SECRET'),redirect_uri:callback(platform)});
    token=await providerJson(`${endpoint}?${query}`);
    const exchange=new URLSearchParams({grant_type:'fb_exchange_token',client_id:setting('META_APP_ID'),client_secret:setting('META_APP_SECRET'),fb_exchange_token:token.access_token});
    token=await providerJson(`${endpoint}?${exchange}`);
  }
  if(!token.access_token||(platform==='google'&&!token.refresh_token)) throw new AppError(422,'Credencial incompleta. Revogue e autorize novamente com consentimento offline.');
  const credentials:Credentials={access_token:token.access_token,refresh_token:token.refresh_token,expires_at:Date.now()+Number(token.expires_in??3600)*1000};
  await db.query('INSERT INTO connections(client_id,platform,credentials) VALUES($1,$2,$3)',[pending.client_id,platform,encrypt(JSON.stringify(credentials))]);
  return NextResponse.redirect(`${setting('APP_URL')}/?client=${pending.client_id}&tab=connections`);
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
export async function googleRequest(token:string,path:string,body?:unknown,loginCustomerId?:string) {
  const headers:Record<string,string>={Authorization:`Bearer ${token}`,'developer-token':setting('GOOGLE_ADS_DEVELOPER_TOKEN'),'Content-Type':'application/json'};
  const manager=loginCustomerId??process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if(manager) headers['login-customer-id']=manager.replaceAll('-','');
  return providerJson(`https://googleads.googleapis.com/${setting('GOOGLE_ADS_API_VERSION')}/${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
}
export async function listRemoteAccounts(connection:Connection) {
  const token=await accessToken(connection);
  const accounts:{externalId:string;name:string;currency:string;timezone:string}[]=[];
  if(connection.platform==='meta') {
    let next:string|undefined=`https://graph.facebook.com/${setting('META_API_VERSION')}/me/adaccounts?fields=id,name,currency,timezone_name&limit=100`;
    while(next) {
      const parsed=new URL(next); if(parsed.hostname!=='graph.facebook.com') throw new AppError(502,'Paginação inválida.');
      const page=await providerJson(next,{headers:{Authorization:`Bearer ${token}`}});
      for(const a of page.data??[]) accounts.push({externalId:a.id,name:a.name,currency:a.currency,timezone:a.timezone_name}); next=page.paging?.next;
    }
  } else {
    const accessible=await googleRequest(token,'customers:listAccessibleCustomers');
    const seen=new Set<string>();
    for(const resource of accessible.resourceNames??[]) {
      const customerId=resource.split('/')[1];
      const rows=await googleRequest(token,`customers/${customerId}/googleAds:searchStream`,{query:'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.status = ENABLED'},customerId);
      for(const batch of rows) for(const row of batch.results??[]) {
        const a=row.customerClient;if(a.manager||seen.has(a.id)) continue;seen.add(a.id);
        accounts.push({externalId:a.id,name:a.descriptiveName||a.id,currency:a.currencyCode,timezone:a.timeZone});
      }
    }
  }
  return accounts;
}
