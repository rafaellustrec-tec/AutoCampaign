import { AppError } from './domain';

export function publicationCapabilities(){
  const creationEnabled=process.env.ADS_PUBLISH_ENABLED==='true';
  const scope=process.env.ADS_PUBLISH_CAMPAIGN_IDS;
  return {creationEnabled,activationEnabled:creationEnabled&&process.env.ADS_ACTIVATION_ENABLED==='true',...(scope!==undefined?{creationCampaignIds:scope.split(',').map(id=>id.trim()).filter(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))}:{})};
}

export function creationAllowed(policy:{creationEnabled:boolean;creationCampaignIds?:string[]},campaignId:string){return policy.creationEnabled&&(!policy.creationCampaignIds||policy.creationCampaignIds.includes(campaignId));}
export function requireCreationAllowed(campaignId:string){if(!creationAllowed(publicationCapabilities(),campaignId))throw new AppError(422,'Criação pausada bloqueada para esta campanha. A liberação está restrita ao teste autorizado.');}

// Creation and spending are independent capabilities; activation is opt-in.
export function requireActivationEnabled(kind: string) {
  if (kind === 'activate' && process.env.ADS_ACTIVATION_ENABLED !== 'true') {
    throw new AppError(422, 'Ativação bloqueada no servidor. O piloto permite somente criação pausada.');
  }
}
