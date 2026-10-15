import test from 'node:test';
import assert from 'node:assert/strict';
import { metaLoginUrl,metaTokenExpiry,exchangeMetaCode } from '../src/lib/meta-login';

const settings={appId:'123',apiVersion:'v26.0',configId:'456',redirectUri:'https://example.com/api/oauth/meta/callback'};
const now=Date.now();
const valid={app_id:'123',type:'SYSTEM_USER',is_valid:true,scopes:['ads_management'],expires_at:Math.floor(now/1000)+86400};

test('Business Login uses configuration, authorization code and opaque state without overriding permissions',()=>{
  const url=metaLoginUrl(settings,'random-state');
  assert.equal(url.origin,'https://www.facebook.com');
  assert.equal(url.pathname,'/v26.0/dialog/oauth');
  assert.equal(url.searchParams.get('config_id'),'456');
  assert.equal(url.searchParams.get('redirect_uri'),settings.redirectUri);
  assert.equal(url.searchParams.get('state'),'random-state');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('override_default_response_type'),'true');
  assert.equal(url.searchParams.has('scope'),false);
  assert.equal(url.searchParams.has('client_secret'),false);
  for(const change of [{appId:''},{configId:''},{apiVersion:'26.0'}])assert.throws(()=>metaLoginUrl({...settings,...change},'state'));
});

test('token validation rejects wrong app, type, permissions, unknown expiry and expired grants',()=>{
  assert.equal(metaTokenExpiry(valid,'123',now),valid.expires_at*1000);
  assert.equal(metaTokenExpiry({...valid,data_access_expires_at:valid.expires_at-3600},'123',now),(valid.expires_at-3600)*1000);
  for(const change of [{is_valid:false},{app_id:'999'},{type:'USER'},{scopes:[]},{scopes:null},{expires_at:0},{expires_at:undefined},{expires_at:Math.floor(now/1000)+10},{data_access_expires_at:1}]) {
    assert.throws(()=>metaTokenExpiry({...valid,...change},'123',now));
  }
});

test('code exchange keeps app secret in POST body, inspects token and never performs personal-user exchange',async()=>{
  const calls:{url:URL;init?:RequestInit}[]=[];
  const result=await exchangeMetaCode({...settings,appSecret:'fixture-secret'},'fixture-code',async(url,init)=>{
    calls.push({url:new URL(url),init});
    return calls.length===1?{access_token:'fixture-token'}:{data:valid};
  });
  assert.equal(calls.length,2);
  assert.equal(calls[0].init?.method,'POST');
  assert.equal(calls[0].url.search,'');
  const form=new URLSearchParams(String(calls[0].init?.body));
  assert.equal(form.get('client_secret'),'fixture-secret');
  assert.equal(form.get('code'),'fixture-code');
  assert.equal(form.get('redirect_uri'),settings.redirectUri);
  assert.equal(form.has('fb_exchange_token'),false);
  assert.equal(calls[1].url.pathname,'/v26.0/debug_token');
  assert.equal(calls[1].url.searchParams.get('input_token'),'fixture-token');
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'),'Bearer 123|fixture-secret');
  assert.deepEqual(result,{access_token:'fixture-token',expires_at:valid.expires_at*1000});
  await assert.rejects(exchangeMetaCode({...settings,appSecret:'fixture-secret'},'code',async()=>({})),/não retornou/);
});
