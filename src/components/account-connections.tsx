'use client';
import { useEffect,useState } from 'react';
type Row=Record<string,any>;
async function api(path:string,body?:unknown){
  const response=await fetch(`/api/${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Não foi possível concluir.');return data;
}
export default function AccountConnections({clients,demo,onAssigned}:{clients:Row[];demo:boolean;onAssigned:()=>Promise<void>}) {
  const [connections,setConnections]=useState<Row[]>([]);const [accounts,setAccounts]=useState<Row[]>([]);
  const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [search,setSearch]=useState('');
  const [selection,setSelection]=useState<string[]>([]);const [mapping,setMapping]=useState<Record<string,string>>({});const [target,setTarget]=useState('');
  async function load(){if(demo)return;const [c,a]=await Promise.all([api('connections'),api('accounts')]);setConnections(c);setAccounts(a);}
  async function run(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn();}catch(error){setNotice(error instanceof Error?error.message:'Falha na operação.');}finally{setBusy(false);}}
  useEffect(()=>{if(!demo)void run(async()=>{await load();if(new URLSearchParams(window.location.search).get('import')==='failed')setNotice('Autorização salva. A importação não terminou; use Atualizar contas para tentar novamente.');});},[demo]);
  const visible=accounts.filter(a=>`${a.name} ${a.external_id} ${a.client_name??''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const eligible=visible.filter(a=>!a.client_id&&a.available&&a.connection_status==='connected');
  const assignable=accounts.filter(a=>!a.client_id&&a.available&&a.connection_status==='connected');
  const pending=Object.entries(mapping).filter(([id,clientId])=>clientId&&assignable.some(a=>a.id===id)).map(([accountId,clientId])=>({accountId,clientId}));
  const disabled=busy||demo;
  return <>
    <section className="card"><h2>Contas da agência</h2><p>Conecte uma vez e importe todas as contas autorizadas. Depois organize os vínculos por cliente.</p><p className="muted">A Meta disponibiliza somente os ativos liberados no consentimento. Para incluir outras contas, autorize novamente e selecione os ativos desejados.</p></section>
    <div className="integration-grid">{['meta','google'].map(platform=><section className="card integration" key={platform}>
      <span className={`platform-logo ${platform}`}>{platform==='meta'?'∞':'G'}</span><h2>{platform==='meta'?'Facebook / Meta Ads':'Google Ads'}</h2>
      <p>As contas autorizadas são importadas e salvas automaticamente, sem selecionar um cliente antes.</p>
      {platform==='google'&&<p className="muted">A conexão Google permite importar contas. A criação de campanhas Google permanece indisponível.</p>}
      <button className="primary" disabled={disabled} onClick={()=>{window.location.href=`/api/oauth/${platform}`;}}>Conectar {platform==='meta'?'Facebook':'Google'} ↗</button>
    </section>)}</div>
    {notice&&<div className="notice" role="alert">{notice}</div>}
    <section className="card"><div className="section-title"><div><h2>Autorizações</h2><p>Atualize autorizações existentes para importar as contas já liberadas.</p></div></div>
      {connections.map(c=><div className="list-row" key={c.id}><strong>{c.platform==='meta'?'Meta Ads':'Google Ads'}</strong><span>{c.status==='connected'?'Autorizada':'Reconectar'} · {({pending:'Importação pendente',running:'Importando',synced:'Lista atualizada',error:'Importação requer atenção'} as Record<string,string>)[c.import_status]}</span><span className="muted">{c.imported_at?new Date(c.imported_at).toLocaleString('pt-BR'):''}</span><button disabled={disabled||c.status!=='connected'} onClick={()=>void run(async()=>{const result=await api(`connections/${c.id}/sync`,{});await load();await onAssigned();setNotice(`${result.count} contas autorizadas salvas. Vínculos existentes preservados.`);})}>Atualizar contas</button></div>)}
      {!connections.length&&<p className="muted">Conecte o Facebook para iniciar a importação.</p>}
    </section>
    <section className="card"><div className="section-title"><div><h2>Lista geral de contas ({accounts.length})</h2><p>Escolha clientes por linha ou aplique um cliente às contas selecionadas. Salve os vínculos juntos.</p></div></div>
      <div className="inline-form"><input aria-label="Buscar contas" placeholder="Buscar por conta, ID ou cliente" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Cliente para contas selecionadas" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Escolha um cliente</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><button disabled={disabled||!target||!selection.length} onClick={()=>setMapping(previous=>({...previous,...Object.fromEntries(selection.filter(id=>assignable.some(a=>a.id===id)).map(id=>[id,target]))}))}>Aplicar aos selecionados</button></div>
      <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Selecionar contas disponíveis" disabled={disabled||!eligible.length} checked={eligible.length>0&&eligible.every(a=>selection.includes(a.id))} onChange={e=>setSelection(e.target.checked?eligible.map(a=>a.id):[])}/></th><th>Conta</th><th>Moeda e fuso</th><th>Situação</th><th>Cliente</th></tr></thead><tbody>
        {visible.map(a=><tr key={a.id}><td><input type="checkbox" aria-label={`Selecionar ${a.name}`} disabled={disabled||!!a.client_id||!a.available||a.connection_status!=='connected'} checked={selection.includes(a.id)} onChange={e=>setSelection(previous=>e.target.checked?[...previous,a.id]:previous.filter(id=>id!==a.id))}/></td><td><strong>{a.name}</strong><small>{a.platform.toUpperCase()} · {a.external_id}</small></td><td>{a.currency}<small>{a.timezone}</small></td><td>{!a.available?'Acesso não confirmado':a.connection_status!=='connected'?'Reconectar':a.client_id?'Vinculada':'Aguardando vínculo'}</td><td>{a.client_id?<strong>{a.client_name}</strong>:<select aria-label={`Cliente para ${a.name}`} value={mapping[a.id]??''} disabled={disabled||!a.available||a.connection_status!=='connected'} onChange={e=>setMapping(previous=>({...previous,[a.id]:e.target.value}))}><option value="">Sem cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}</td></tr>)}
      </tbody></table></div>
      {!visible.length&&<p className="muted">Nenhuma conta salva para esta busca. Autorize os ativos e atualize a lista.</p>}
      <div className="modal-actions"><span className="muted">{pending.length} vínculos preparados · até 500 por lote</span><button className="primary" disabled={disabled||!pending.length||pending.length>500} onClick={()=>void run(async()=>{const result=await api('accounts/assign',{assignments:pending});setMapping({});setSelection([]);await load();await onAssigned();setNotice(`${result.linked} contas vinculadas. Nenhuma campanha foi criada ou ativada.`);})}>Salvar vínculos em lote</button></div>
    </section>
  </>;
}
