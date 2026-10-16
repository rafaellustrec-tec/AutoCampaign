type Row=Record<string,any>;
export function campaignSetup(accounts:Row[],campaigns:Row[]) {
 const available=accounts.filter(a=>a.platform==='meta'&&a.connection_status==='connected'&&a.available!==false);
 const previous=campaigns.find(c=>c.briefing?.channels?.[0]?.kind==='meta_whatsapp'&&available.some(a=>a.id===c.briefing.channels[0].accountId));
 return {available,previous,accountId:previous?.briefing.channels[0].accountId??(available.length===1?available[0].id:'')};
}
export function campaignName(client:string,offer:string){return `${client} · ${offer.trim().split('\n')[0]}`.slice(0,160);}
export function budgetEstimate(budget:number,start:string,end:string){const days=(Date.parse(end)-Date.parse(start))/86400000+1;return Number.isFinite(days)&&days>0&&Number.isFinite(budget)?{days,total:Math.round(days*budget*100)/100}:null;}
