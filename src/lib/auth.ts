import { cookies } from 'next/headers';
import type { PoolClient } from 'pg';
import { db } from './db';
import { hash } from './security';
import { AppError, type Role } from './domain';
export type User={id:string;name:string;email:string;role:Role};
export async function currentUser():Promise<User|null> {
  const token=(await cookies()).get('agency_session')?.value;
  if(!token) return null;
  return (await db.query('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=$1 AND s.expires_at>now() AND NOT u.disabled',[hash(token)])).rows[0]??null;
}
export async function requireUser() { const user=await currentUser(); if(!user) throw new AppError(401,'Entre na sua conta.'); return user; }
export async function requireClient(user:User,clientId:string,tx:PoolClient|typeof db=db) {
  const result=await tx.query('SELECT id FROM clients WHERE id=$1 AND ($2 OR EXISTS(SELECT 1 FROM client_members WHERE client_id=$1 AND user_id=$3))',[clientId,user.role==='admin',user.id]);
  if(!result.rowCount) throw new AppError(404,'Cliente não encontrado.');
}
export function checkOrigin(request:Request) {
  const expected=new URL(process.env.APP_URL??'http://localhost:3000').origin;
  if(request.headers.get('origin')!==expected) throw new AppError(403,'Origem inválida.');
}
