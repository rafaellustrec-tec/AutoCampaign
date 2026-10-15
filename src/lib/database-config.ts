import type { PoolConfig } from 'pg';
import { supabaseRootCA } from './supabase-ca';
export function databaseConnectionConfig(connectionString:string|undefined):PoolConfig {
  if(!connectionString)return {connectionString};
  const url=new URL(connectionString);
  const managedSupabase=url.hostname.endsWith('.supabase.co')||url.hostname.endsWith('.supabase.com');
  if(!managedSupabase)return {connectionString};
  // pg URL SSL options override the explicit TLS object, so remove them.
  for(const key of ['ssl','sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat'])url.searchParams.delete(key);
  return {connectionString:url.toString(),ssl:{ca:supabaseRootCA,rejectUnauthorized:true}};
}
