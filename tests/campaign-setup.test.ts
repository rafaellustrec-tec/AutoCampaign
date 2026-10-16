import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignSetup,campaignName,budgetEstimate} from '../src/lib/campaign-setup';
test('reuses only a campaign whose WhatsApp account is still connected to the selected client',()=>{
 const account={id:'current',platform:'meta',connection_status:'connected'};
 const campaigns=[{briefing:{channels:[{kind:'meta_whatsapp',accountId:'other-client'}]}},{briefing:{channels:[{kind:'meta_whatsapp',accountId:'current',pageId:'123'}]}}];
 assert.equal(campaignSetup([account],campaigns).previous,campaigns[1]);
 assert.equal(campaignSetup([{...account,available:false}],campaigns).previous,undefined);
 assert.equal(campaignSetup([{...account,connection_status:'expired'}],campaigns).accountId,'');
 assert.equal(campaignSetup([account,{...account,id:'second'}],[]).accountId,'');
});
test('names are bounded and budget estimate uses inclusive calendar days',()=>{
 assert.equal(campaignName('Cliente','  Oferta\nDetalhes'),'Cliente · Oferta');
 assert.equal(campaignName('Cliente','x'.repeat(300)).length,160);
 assert.deepEqual(budgetEstimate(30,'2026-10-20','2026-10-22'),{days:3,total:90});
 assert.equal(budgetEstimate(30,'2026-10-22','2026-10-20'),null);
 assert.equal(budgetEstimate(30,'',''),null);
});
