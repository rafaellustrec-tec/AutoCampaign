import { AppError } from './domain';

// Creation and spending are independent capabilities; activation is opt-in.
export function requireActivationEnabled(kind: string) {
  if (kind === 'activate' && process.env.ADS_ACTIVATION_ENABLED !== 'true') {
    throw new AppError(422, 'Ativação bloqueada no servidor. O piloto permite somente criação pausada.');
  }
}
