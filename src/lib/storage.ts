import { S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand,CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from './domain';
function client() {
  if(!process.env.S3_BUCKET||!process.env.S3_ACCESS_KEY_ID||!process.env.S3_SECRET_ACCESS_KEY) throw new AppError(422,'Armazenamento S3 não configurado.');
  return new S3Client({region:process.env.S3_REGION??'us-east-1',endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
}
export async function uploadUrl(key:string,type:string,size:number) { return getSignedUrl(client(),new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,ContentType:type,ContentLength:size}),{expiresIn:300}); }
export async function verifyUpload(key:string,type:string,size:number) { const head=await client().send(new HeadObjectCommand({Bucket:process.env.S3_BUCKET,Key:key})); if(head.ContentType!==type||head.ContentLength!==size) throw new AppError(422,'Arquivo enviado não corresponde ao cadastro.'); }
export async function freezeUpload(source:string,destination:string,type:string,size:number) {const s3=client();const head=await s3.send(new HeadObjectCommand({Bucket:process.env.S3_BUCKET,Key:source}));if(head.ContentType!==type||head.ContentLength!==size||!head.ETag)throw new AppError(422,'Arquivo enviado não corresponde ao cadastro.');await s3.send(new CopyObjectCommand({Bucket:process.env.S3_BUCKET,Key:destination,CopySource:`${process.env.S3_BUCKET}/${source.split('/').map(encodeURIComponent).join('/')}`,CopySourceIfMatch:head.ETag}));}
export async function assetBytes(key:string) {const object=await client().send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));if(!object.Body)throw new AppError(422,'Arquivo não disponível.');return object.Body.transformToByteArray();}
export async function storePdf(key:string,bytes:Uint8Array) {await client().send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:bytes,ContentType:'application/pdf'}));}
export async function downloadUrl(key:string) {return getSignedUrl(client(),new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,ResponseContentDisposition:'attachment; filename="relatorio.pdf"'}),{expiresIn:120});}
export async function previewUrl(key:string) {return getSignedUrl(client(),new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,ResponseContentDisposition:'inline'}),{expiresIn:120});}
