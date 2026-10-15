'use client';
import { useState,type FormEvent } from 'react';
import type { Briefing } from '@/lib/domain';
type Row=Record<string,any>;
export default function WhatsAppCampaignForm({accounts,assets,editing,busy,close,save}:{accounts:Row[];assets:Row[];editing:Row|null;busy:boolean;close:()=>void;save:(b:Briefing)=>Promise<void>}) {
 const initial=editing?.briefing;const channel=initial?.channels?.[0];
 const [phone,setPhone]=useState(channel?.whatsappNumber??'');const [message,setMessage]=useState(channel?.whatsappMessage??'');
 const digits=phone.replace(/[+\s().-]/g,'');const destination=`https://wa.me/${digits}${message?`?text=${encodeURIComponent(message)}`:''}`;
 const readyAssets=assets.filter(a=>a.status==='ready'&&['image/jpeg','image/png','image/webp'].includes(a.content_type)&&Number(a.size)<=30*1024*1024);
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const str=(name:string)=>String(f.get(name)??'');
  void save({name:str('name'),offer:str('offer'),location:str('location'),startDate:str('startDate'),endDate:str('endDate'),channels:[{platform:'meta',kind:'meta_whatsapp',accountId:str('accountId'),dailyBudget:Number(str('dailyBudget')),destination,whatsappNumber:phone,whatsappMessage:message,pageId:str('pageId'),geoTargetId:str('geoTargetId'),metaCountry:'BR',conversionId:'',assetIds:f.getAll('assetIds').map(String),keywords:[],negatives:[],headlines:[],descriptions:[]}]});
 }
 return <div className="modal-backdrop"><form className="modal briefing" onSubmit={submit}><div className="section-title"><div><span className="eyebrow">META ADS → WHATSAPP</span><h2>{editing?'Revisar campanha de WhatsApp':'Nova campanha de WhatsApp'}</h2></div><button type="button" aria-label="Fechar formulário" onClick={close}>×</button></div><p className="muted">Defina a oferta e os materiais. Revise a proposta antes de criar a estrutura pausada.</p><div className="form-grid">
 <label className="full">Nome da campanha<input name="name" defaultValue={initial?.name} minLength={3} maxLength={160} required/></label>
 <label className="full">Texto do anúncio / oferta<textarea name="offer" defaultValue={initial?.offer} minLength={3} maxLength={3000} required/></label>
 <label>Conta Meta<select name="accountId" defaultValue={channel?.accountId} required><option value="">Selecione uma conta conectada</option>{accounts.filter(a=>a.platform==='meta'&&a.connection_status==='connected').map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency} · {a.timezone}</option>)}</select></label>
 <label>Orçamento diário na moeda da conta<input type="number" name="dailyBudget" defaultValue={channel?.dailyBudget} min="0.01" max="100000" step="0.01" required/></label>
 <label>ID da página do Facebook<input name="pageId" defaultValue={channel?.pageId} pattern="[0-9]+" required/></label>
 <label>WhatsApp com DDI<input name="whatsappNumber" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+55 71 99999-9999" maxLength={30} required/></label>
 <label className="full">Mensagem inicial no link (opcional)<textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={300} placeholder="Olá! Quero saber mais sobre a avaliação."/></label>
 <label className="full">Destino gerado para conferência<input value={destination} readOnly/></label>
 <label>Cidade / região para conferência<input name="location" defaultValue={initial?.location} minLength={2} required/></label>
 <label>ID oficial da cidade na Meta<input name="geoTargetId" defaultValue={channel?.geoTargetId} pattern="[0-9]+" required/></label>
 <label>Início — fuso da conta<input type="date" name="startDate" defaultValue={initial?.startDate} required/></label>
 <label>Fim — fuso da conta<input type="date" name="endDate" defaultValue={initial?.endDate} required/></label>
 <div className="full"><label>Imagens aprovadas — até 30 MB cada</label>{readyAssets.map(a=><label className="asset-check" key={a.id}><input type="checkbox" name="assetIds" value={a.id} defaultChecked={channel?.assetIds?.includes(a.id)}/>{a.name}</label>)}{!readyAssets.length&&<p className="muted">Envie pelo menos uma imagem na biblioteca do cliente antes de salvar.</p>}</div>
 </div><p className="muted">Modelo inicial: engajamento com conversas no WhatsApp, cidade informada, idade de 18 a 65 anos e posicionamentos automáticos. O número precisa estar vinculado à página. Sem pixel ou formulário de leads nesta versão.</p><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={busy||!readyAssets.length}>Salvar briefing</button></div></form></div>;
}
