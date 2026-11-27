import {useRef,useState} from 'react';
import {Button,Modal} from './ui';
import type {GatewayConfig} from './receiving-page';
const endpoint=(v:GatewayConfig)=>{try{const u=new URL(v.url.trim().replace(/\/$/,'')+'/chat/completions');return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&!!v.key.trim()&&!!v.model.trim()?u:null}catch{return null}};
const empty=(v:GatewayConfig)=>!v.url.trim()&&!v.key.trim()&&!v.model.trim();
const status=(v:GatewayConfig)=>empty(v)?'未配置':v.tested==='ok'?'文本连接正常':v.tested==='failed'?'连接失败':'已配置 · 未验证';
export function GatewaySettings({value,onChange}:{value:GatewayConfig;onChange:(v:GatewayConfig)=>void}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false);
 const active=useRef<AbortController|null>(null);
 function change(k:'url'|'key'|'model',v:string){active.current?.abort();active.current=null;setBusy(false);setDraft(g=>({...g,[k]:v,tested:undefined}))}
 function close(){active.current?.abort();active.current=null;setBusy(false);setOpen(false);setVisible(false)}
 async function test(){const url=endpoint(draft);if(!url||busy)return;const controller=new AbortController();active.current=controller;setBusy(true);setDraft(v=>({...v,tested:undefined}));try{
 const res=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+draft.key,'Content-Type':'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),body:JSON.stringify({model:draft.model,messages:[{role:'user',content:'Reply with OK. This is a connection test. No external tools are needed.'}]})});
 if(!res.ok)throw Error('connection test failed');const data=await res.json();const message=data?.choices?.[0]?.message;
 if(typeof message?.content!=='string'||!message.content.trim()||message.refusal||data.choices[0].finish_reason==='content_filter')throw Error('invalid completion');
 if(active.current===controller)setDraft(v=>({...v,tested:'ok'}))
 }catch{if(active.current===controller)setDraft(v=>({...v,tested:'failed'}))}finally{if(active.current===controller){active.current=null;setBusy(false)}}}
 return <><Button variant="ghost" className="studio-settings-row" onClick={()=>{setDraft(value);setVisible(false);setOpen(true)}}><span>AI Gateway · {status(value)}</span><span aria-hidden="true">›</span></Button><Modal open={open} onClose={close} title="AI Gateway" footer={<div className="grid grid-cols-2 gap-3"><Button variant="secondary" onClick={close}>取消</Button><Button disabled={busy||!endpoint(draft)&&!empty(draft)} onClick={()=>{onChange(draft);close()}}>保存配置</Button></div>}><div className="space-y-4"><label className="block text-sm">Agent API Base URL<input type="url" value={draft.url} onChange={e=>change('url',e.target.value)} placeholder="https://gateway.example.com/v1"/></label><label className="block text-sm">API Key<input type={visible?'text':'password'} autoComplete="off" value={draft.key} onChange={e=>change('key',e.target.value)}/></label><Button variant="secondary" size="sm" onClick={()=>setVisible(v=>!v)}>{visible?'隐藏密钥':'显示密钥'}</Button><label className="block text-sm">模型或 Agent ID<input value={draft.model} onChange={e=>change('model',e.target.value)}/></label><div className="flex items-center justify-between gap-2"><span role="status" className={draft.tested==='ok'?'text-success':draft.tested==='failed'?'text-danger':'text-muted'}>{busy?'测试中…':status(draft)}</span><Button variant="secondary" disabled={!endpoint(draft)||busy} onClick={()=>void test()}>测试连接</Button></div><p className="text-xs text-muted">测试仅发送一条文本，不发送照片或库存数据；文本通过不代表图片识别或检索能力已验证。凭据仅保留在当前会话。</p></div></Modal></>
}
