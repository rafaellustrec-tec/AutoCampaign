import { AppError } from './domain';

export function googleLoginUrl(clientId:string,redirectUri:string,state:string) {
  const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,state,response_type:'code',scope:'https://www.googleapis.com/auth/adwords',access_type:'offline',prompt:'consent'}).toString();
  return target;
}

export function googleCustomerId(value:string) {
  const id=value.replaceAll('-','');
  if(!/^\d{10}$/.test(id))throw new AppError(422,'Informe o ID Google Ads com dez dígitos.');
  return id;
}

type Request=(path:string,body?:unknown,manager?:string|null)=>Promise<any>;
type Account={externalId:string;name:string;currency:string;timezone:string};
export async function googleAccessibleAccounts(request:Request,managerId?:string) {
  // Discovery is based on OAuth access, not on the developer-token owner/MCC.
  const accessible=await request('customers:listAccessibleCustomers',undefined,null);
  const roots=managerId?[googleCustomerId(managerId)]:(accessible.resourceNames??[]).map((resource:string)=>{
    if(!/^customers\/\d{10}$/.test(resource))throw new AppError(502,'Identificador de conta Google inválido.');
    return resource.split('/')[1];
  });
  const seen=new Set<string>();const accounts:Account[]=[];
  const add=(a:any)=>{
    const id=googleCustomerId(String(a.id));
    if(seen.has(id))return;
    if(!a.currencyCode||!a.timeZone)throw new AppError(502,'Moeda ou fuso da conta não confirmado pelo Google.');
    seen.add(id);accounts.push({externalId:id,name:a.descriptiveName||id,currency:a.currencyCode,timezone:a.timeZone});
  };
  for(const root of new Set<string>(roots)) {
    const context=managerId?googleCustomerId(managerId):null;
    const metadata=await request(`customers/${root}/googleAds:searchStream`,{query:'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status FROM customer'},context);
    const customer=metadata.flatMap((batch:any)=>batch.results??[]).find((row:any)=>String(row.customer?.id)===root)?.customer;
    if(!customer)throw new AppError(422,'O Google não confirmou acesso à conta selecionada.');
    if(!customer.manager){if(customer.status==='ENABLED')add(customer);continue;}
    // customer_client includes descendants, including accounts under sub-managers.
    const rows=await request(`customers/${root}/googleAds:searchStream`,{query:'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.status = ENABLED'},root);
    for(const batch of rows)for(const row of batch.results??[])if(!row.customerClient.manager)add(row.customerClient);
  }
  return accounts;
}
