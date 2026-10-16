import test from 'node:test';import assert from 'node:assert/strict';
import {clientSituation,portfolioTotals,searchClients,activityLabel,type PortfolioClient} from '../src/lib/portfolio-model';
const base:PortfolioClient={id:'1',name:'Clínica Horizonte',accountCount:1,connectedAccounts:1,platforms:['meta'],connectionIssues:0,failedJobs:0,errorCampaigns:0,reviewCount:0,activeCampaigns:0,campaignCount:0,approvedCount:0,draftCount:0,assignees:[]};
test('portfolio priorities are evidence-based and deterministic',()=>{
 assert.equal(clientSituation({...base,reviewCount:2,connectionIssues:1}).tab,'connections');
 assert.equal(clientSituation({...base,errorCampaigns:1}).tab,'campaigns');
 assert.equal(clientSituation({...base,failedJobs:1}).tab,'jobs');
 assert.equal(clientSituation({...base,accountCount:0}).key,'setup');
 assert.equal(clientSituation({...base,reviewCount:1}).tab,'approvals');
 assert.equal(clientSituation({...base,activeCampaigns:1}).key,'active');
 assert.equal(clientSituation(base).key,'idle');
});
test('portfolio totals count clients once while counting every pending and active campaign',()=>{
 assert.deepEqual(portfolioTotals([{...base,failedJobs:8,connectionIssues:2,reviewCount:2,activeCampaigns:3},{...base,id:'2',accountCount:0}]),{clients:2,attention:2,reviews:2,active:3});
 assert.deepEqual(portfolioTotals([]),{clients:0,attention:0,reviews:0,active:0});
 assert.equal(searchClients([base],'  CLINICA ').length,1);assert.equal(searchClients([base],'outro').length,0);
 assert.equal(activityLabel('briefing.saved'),'Campanha salva para revisão');assert.equal(activityLabel('unrecognized-provider-error-with-secret'),'Atualização registrada');
});
