import test from 'node:test';
import assert from 'node:assert/strict';
import { googleLoginUrl,googleCustomerId,googleAccessibleAccounts } from '../src/lib/google-connection';
import { googleRequest } from '../src/lib/oauth';

const leaf={id:'1234567890',descriptiveName:'Cliente',currencyCode:'BRL',timeZone:'America/Bahia',manager:false,status:'ENABLED'};
const manager={...leaf,id:'9999999999',manager:true};
test('Google OAuth requests offline consent with single-use state and exact callback',()=>{
  const url=googleLoginUrl('fixture.apps.googleusercontent.com','https://example.com/api/oauth/google/callback','opaque-state');
  assert.equal(url.origin,'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/adwords');
  assert.equal(url.searchParams.get('access_type'),'offline');
  assert.equal(url.searchParams.get('prompt'),'consent');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('state'),'opaque-state');
  assert.equal(url.searchParams.get('redirect_uri'),'https://example.com/api/oauth/google/callback');
  assert.equal(url.searchParams.has('client_secret'),false);
});
test('Google customer ID normalizes display hyphens and rejects malformed IDs',()=>{
  assert.equal(googleCustomerId('123-456-7890'),'1234567890');
  for(const value of ['123','123456789a','../customers/1234567890'])assert.throws(()=>googleCustomerId(value));
});
test('direct advertiser discovery does not send an MCC context or list managers as advertisers',async()=>{
  const calls:any[]=[];
  const accounts=await googleAccessibleAccounts(async(path,body,context)=>{
    calls.push({path,body,context});
    return !body?{resourceNames:['customers/'+leaf.id]}:[{results:[{customer:leaf}]}];
  });
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.context===null));
  assert.deepEqual(accounts,[{externalId:leaf.id,name:'Cliente',currency:'BRL',timezone:'America/Bahia'}]);
});
test('MCC discovery includes descendants, excludes managers and deduplicates direct access',async()=>{
  const accounts=await googleAccessibleAccounts(async(path,body,context)=>{
    if(!body)return {resourceNames:['customers/'+manager.id,'customers/'+leaf.id]};
    const query=(body as {query:string}).query;
    if(query.includes('FROM customer_client')){
      assert.equal(context,manager.id);
      return [{results:[{customerClient:manager},{customerClient:leaf},{customerClient:leaf}]}];
    }
    assert.equal(context,null);
    return [{results:[{customer:path.includes(manager.id)?manager:leaf}]}];
  });
  assert.equal(accounts.length,1);assert.equal(accounts[0].externalId,leaf.id);
});
test('explicit MCC restricts discovery to that hierarchy and failures are not hidden',async()=>{
  const calls:any[]=[];
  const accounts=await googleAccessibleAccounts(async(path,body,context)=>{
    calls.push({path,body,context});
    if(!body){assert.equal(context,null);return {resourceNames:[]};}
    assert.equal(context,manager.id);assert.ok(path.includes(manager.id));
    return [{results:(body as {query:string}).query.includes('FROM customer_client')?[{customerClient:leaf}]:[{customer:manager}]}];
  },'999-999-9999');
  assert.equal(accounts.length,1);assert.equal(calls.length,3);
  await assert.rejects(googleAccessibleAccounts(async()=>{throw Error('quota fixture');}),/quota fixture/);
  await assert.rejects(googleAccessibleAccounts(async()=>({resourceNames:['customers/invalid']})),/Identificador/);
});
test('Google REST uses Cloud project OAuth without developer tokens and suppresses MCC for discovery',async()=>{
  const previous={version:process.env.GOOGLE_ADS_API_VERSION,developer:process.env.GOOGLE_ADS_DEVELOPER_TOKEN,manager:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID};
  const fetch=globalThis.fetch;const calls:any[]=[];
  try{
    process.env.GOOGLE_ADS_API_VERSION='v25';process.env.GOOGLE_ADS_DEVELOPER_TOKEN='fixture-developer';process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID='999-999-9999';
    globalThis.fetch=async(input,init)=>{calls.push({url:new URL(String(input)),headers:new Headers(init?.headers),method:init?.method});return Response.json({resourceNames:[]});};
    await googleRequest('fixture-access','customers:listAccessibleCustomers',undefined,null);
    assert.equal(calls[0].url.hostname,'googleads.googleapis.com');
    assert.equal(calls[0].url.pathname,'/v25/customers:listAccessibleCustomers');
    assert.equal(calls[0].headers.get('developer-token'),null);
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    assert.equal(calls[0].headers.get('login-customer-id'),null);
    assert.equal(calls[0].headers.get('Authorization'),'Bearer fixture-access');
    await googleRequest('fixture-access',`customers/${leaf.id}/googleAds:searchStream`,{query:'SELECT customer.id FROM customer'});
    assert.equal(calls[1].headers.get('login-customer-id'),manager.id);
    assert.equal(calls[1].method,'POST');assert.equal(calls[1].headers.get('developer-token'),null);
  }finally{
    globalThis.fetch=fetch;
    for(const [key,value] of Object.entries({GOOGLE_ADS_API_VERSION:previous.version,GOOGLE_ADS_DEVELOPER_TOKEN:previous.developer,GOOGLE_ADS_LOGIN_CUSTOMER_ID:previous.manager})){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
