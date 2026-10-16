import test from 'node:test';
import assert from 'node:assert/strict';
import { requireActivationEnabled,publicationCapabilities,creationAllowed,requireCreationAllowed } from '../src/lib/publication-policy';
import { executePublication } from '../src/lib/publishers';
import {randomUUID} from 'node:crypto';

test('pilot creation scope rejects other campaigns and invalid or empty allowlists before database access',async()=>{
 const saved={enabled:process.env.ADS_PUBLISH_ENABLED,scope:process.env.ADS_PUBLISH_CAMPAIGN_IDS};const pilot=randomUUID(),other=randomUUID();
 try{process.env.ADS_PUBLISH_ENABLED='true';process.env.ADS_PUBLISH_CAMPAIGN_IDS=pilot;
  assert.equal(creationAllowed(publicationCapabilities(),pilot),true);assert.equal(creationAllowed(publicationCapabilities(),other),false);assert.doesNotThrow(()=>requireCreationAllowed(pilot));
  await assert.rejects(executePublication({id:'unused',client_id:'unused',campaign_id:other,version:1,kind:'create',lease_token:'unused'}),/restrita ao teste/);
  for(const scope of ['', 'invalid']){process.env.ADS_PUBLISH_CAMPAIGN_IDS=scope;assert.throws(()=>requireCreationAllowed(pilot),/restrita ao teste/);}
 }finally{for(const [key,value]of Object.entries({ADS_PUBLISH_ENABLED:saved.enabled,ADS_PUBLISH_CAMPAIGN_IDS:saved.scope})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('UI capabilities fail closed and activation also requires publication',()=>{
 const saved={create:process.env.ADS_PUBLISH_ENABLED,activate:process.env.ADS_ACTIVATION_ENABLED};
 try{
  for(const value of [undefined,'false','','TRUE','1']){
   if(value===undefined)delete process.env.ADS_PUBLISH_ENABLED;else process.env.ADS_PUBLISH_ENABLED=value;
   process.env.ADS_ACTIVATION_ENABLED='true';
   assert.deepEqual(publicationCapabilities(),{creationEnabled:false,activationEnabled:false});
  }
  process.env.ADS_PUBLISH_ENABLED='true';process.env.ADS_ACTIVATION_ENABLED='false';
  assert.deepEqual(publicationCapabilities(),{creationEnabled:true,activationEnabled:false});
  process.env.ADS_ACTIVATION_ENABLED='true';assert.deepEqual(publicationCapabilities(),{creationEnabled:true,activationEnabled:true});
 }finally{
  if(saved.create===undefined)delete process.env.ADS_PUBLISH_ENABLED;else process.env.ADS_PUBLISH_ENABLED=saved.create;
  if(saved.activate===undefined)delete process.env.ADS_ACTIVATION_ENABLED;else process.env.ADS_ACTIVATION_ENABLED=saved.activate;
 }
});

test('activation fails closed even when publication is enabled; queued jobs cannot bypass the gate', async () => {
  const previous = process.env.ADS_ACTIVATION_ENABLED;
  const publication = process.env.ADS_PUBLISH_ENABLED;
  try {
    process.env.ADS_PUBLISH_ENABLED = 'true';
    for (const value of [undefined, 'false', '', 'TRUE', '1']) {
      if (value === undefined) delete process.env.ADS_ACTIVATION_ENABLED;
      else process.env.ADS_ACTIVATION_ENABLED = value;
      assert.throws(() => requireActivationEnabled('activate'), /Ativação bloqueada/);
      assert.doesNotThrow(() => requireActivationEnabled('create'));
      await assert.rejects(executePublication({id:'unused',client_id:'unused',campaign_id:'unused',version:1,kind:'activate',lease_token:'unused'}), /Ativação bloqueada/);
    }
    process.env.ADS_ACTIVATION_ENABLED = 'true';
    assert.doesNotThrow(() => requireActivationEnabled('activate'));
  } finally {
    if (previous === undefined) delete process.env.ADS_ACTIVATION_ENABLED;
    else process.env.ADS_ACTIVATION_ENABLED = previous;
    if (publication === undefined) delete process.env.ADS_PUBLISH_ENABLED;
    else process.env.ADS_PUBLISH_ENABLED = publication;
  }
});
