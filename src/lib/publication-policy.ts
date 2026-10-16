import { AppError } from './domain';

export function publicationCapabilities(){
  const creationEnabled=process.env.ADS_PUBLISH_ENABLED==='true';
  return {creationEnabled,activationEnabled:creationEnabled&&process.env.ADS_ACTIVATION_ENABLED==='true'};
}

// Creation and spending are independent capabilities; activation is opt-in.
export function requireActivationEnabled(kind: string) {
  if (kind === 'activate' && process.env.ADS_ACTIVATION_ENABLED !== 'true') {
    throw new AppError(422, 'Ativação bloqueada no servidor. O piloto permite somente criação pausada.');
  }
}
