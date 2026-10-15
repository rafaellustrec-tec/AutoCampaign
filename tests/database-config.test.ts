import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { databaseConnectionConfig } from '../src/lib/database-config';
test('Supabase usa CA oficial e verifica certificado e hostname',()=>{
 const config=databaseConnectionConfig('postgresql://fixture:unused@aws-1-ca-central-1.pooler.supabase.com:6543/postgres?ssl=false&sslmode=disable&sslrootcert=/wrong&application_name=orbita');
 const ssl=config.ssl as {ca:string;rejectUnauthorized:boolean};
 assert.equal(ssl.rejectUnauthorized,true);
 assert.equal(new X509Certificate(ssl.ca).fingerprint256.replaceAll(':','').toLowerCase(),'807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa');
 const url=new URL(config.connectionString!);assert.equal(url.searchParams.has('ssl'),false);assert.equal(url.searchParams.has('sslmode'),false);assert.equal(url.searchParams.has('sslrootcert'),false);assert.equal(url.searchParams.get('application_name'),'orbita');
});
test('banco local mantém configuração e não herda a CA da Supabase',()=>{
 const url='postgresql://fixture:unused@localhost:5432/test?options=-csearch_path%3Dfixture';
 assert.deepEqual(databaseConnectionConfig(url),{connectionString:url});
 assert.deepEqual(databaseConnectionConfig(undefined),{connectionString:undefined});
 assert.equal(databaseConnectionConfig('postgresql://fixture:unused@supabase.com.example.org/test').ssl,undefined);
});
