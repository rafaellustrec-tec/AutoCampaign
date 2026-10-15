import { db } from '../src/lib/db';
import { passwordHash } from '../src/lib/security';
const [email,name,role='admin'] = process.argv.slice(2);
const password=process.env.INITIAL_PASSWORD;
if(!email||!name||!password||password.length<12||!['admin','operator','approver'].includes(role)) throw new Error('Uso: INITIAL_PASSWORD no ambiente (mínimo 12 caracteres), npm run user:create -- email nome [admin|operator|approver]');
try { await db.query('INSERT INTO users(email,name,role,password_hash) VALUES($1,$2,$3,$4)',[email.toLowerCase(),name,role,passwordHash(password)]); console.log('Usuário criado.'); } finally { await db.end(); }
