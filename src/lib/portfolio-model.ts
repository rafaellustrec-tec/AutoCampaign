export type PortfolioClient={id:string;name:string;platforms:string[];accountCount:number;connectedAccounts:number;connectionIssues:number;failedJobs:number;errorCampaigns:number;reviewCount:number;activeCampaigns:number;campaignCount:number;approvedCount:number;draftCount:number;assignees:string[]};
export type PortfolioActivity={id:string;clientId:string;clientName:string;action:string;userName:string;createdAt:string};
export type Portfolio={clients:PortfolioClient[];activity:PortfolioActivity[];updatedAt:string};
export function clientSituation(c:PortfolioClient){
 if(c.connectionIssues)return {key:'attention',label:'Atenção',action:'Verificar conexão das contas',tab:'connections',priority:0};
 if(c.errorCampaigns)return {key:'attention',label:'Atenção',action:'Conferir campanha com erro ou anúncio reprovado',tab:'campaigns',priority:1};
 if(c.failedJobs)return {key:'attention',label:'Atenção',action:'Revisar execução com falha',tab:'jobs',priority:2};
 if(!c.accountCount)return {key:'setup',label:'Configurar',action:'Vincular uma conta de anúncios',tab:'connections',priority:3};
 if(c.reviewCount)return {key:'review',label:'Revisão',action:`Conferir ${c.reviewCount} ${c.reviewCount===1?'campanha pendente':'campanhas pendentes'}`,tab:'approvals',priority:4};
 if(c.approvedCount)return {key:'ready',label:'Estrutura aprovada',action:'Conferir estrutura aprovada; criação bloqueada',tab:'campaigns',priority:5};
 if(c.draftCount)return {key:'draft',label:'Rascunho',action:'Revisar rascunho e gerar proposta',tab:'campaigns',priority:6};
 if(c.activeCampaigns)return {key:'active',label:'Em execução',action:'Acompanhar campanhas registradas como ativas',tab:'campaigns',priority:7};
 return {key:'idle',label:'Sem campanhas',action:'Preparar primeira campanha WhatsApp',tab:'campaigns',priority:8};
}
export function portfolioTotals(clients:PortfolioClient[]){return {clients:clients.length,attention:clients.filter(c=>['attention','setup'].includes(clientSituation(c).key)).length,reviews:clients.reduce((n,c)=>n+c.reviewCount,0),active:clients.reduce((n,c)=>n+c.activeCampaigns,0)};}
export function searchClients(clients:PortfolioClient[],search:string){const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');const q=normalize(search.trim());return clients.filter(c=>normalize(c.name).includes(q));}
const activityNames:Record<string,string>={'client.created':'Cliente cadastrado','account.linked':'Conta vinculada','account.assigned':'Conta vinculada','accounts.assigned':'Contas vinculadas','accounts.synced':'Contas sincronizadas','connection.created':'Conexão autorizada','connection.synced':'Contas sincronizadas','briefing.saved':'Campanha salva para revisão','campaign.propose':'Proposta gerada','campaign.approve':'Estrutura aprovada','campaign.create':'Criação pausada solicitada','campaign.activate':'Ativação solicitada','asset.ready':'Imagem disponibilizada','member.granted':'Acesso ao cliente concedido','report.saved':'Relatório salvo','job.completed':'Execução concluída','job.failed':'Falha de execução registrada'};
export function activityLabel(action:string){return activityNames[action]??'Atualização registrada';}
