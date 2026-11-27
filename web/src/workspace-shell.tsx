import {createContext,useContext,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {House,Package,Warehouse,Settings} from './icons';
import {Button} from './ui';
import {GatewaySettings} from './gateway-settings';
import type {GatewayConfig} from './receiving-page';
export type Page='home'|'parts'|'storage'|'settings';
const nav=[['home','首页',House],['parts','元件',Package],['storage','仓储',Warehouse],['settings','设置',Settings]] as const;
type Presentation={source:string;linkedDetail:boolean;workflow:boolean};
type Registration={report:(p:Presentation)=>void;actions:{current:{navigate:(p:Page)=>void;gateway:(g:GatewayConfig)=>void}|null}};
const FrameContext=createContext<Registration|null>(null);
// One mounted shell owns navigation and common settings across both data adapters.
// Views register only presentation and cleanup, never their own navigation DOM.
export function useWorkspaceFrame(p:Presentation,navigate:(p:Page)=>void,gateway:(g:GatewayConfig)=>void){
 const frame=useContext(FrameContext);
 if(!frame)throw Error('workspace frame missing');
 const latest=useRef({navigate,gateway});latest.current={navigate,gateway};
 useLayoutEffect(()=>{const actions={navigate:(v:Page)=>latest.current.navigate(v),gateway:(g:GatewayConfig)=>latest.current.gateway(g)};frame.actions.current=actions;return()=>{if(frame.actions.current===actions)frame.actions.current=null}},[frame.actions]);
 useLayoutEffect(()=>{frame.report(p)},[frame.report,p.source,p.linkedDetail,p.workflow]);
}
export function WorkspaceShell({page,onPage,gateway,onGateway,onOpenVersion,children}:{page:Page;onPage:(v:Page)=>void;gateway:GatewayConfig;onGateway:(g:GatewayConfig)=>void;onOpenVersion:()=>void;children:ReactNode}){
 const [presentation,report]=useState<Presentation>({source:'当前库存：演示库存',linkedDetail:false,workflow:false});
 const actions=useRef<Registration['actions']['current']>(null);
 const changePage=(v:Page)=>{if(actions.current)actions.current.navigate(v);else onPage(v)};
 const changeGateway=(v:GatewayConfig)=>{if(actions.current)actions.current.gateway(v);else onGateway(v)};
 const {source,linkedDetail,workflow}=presentation;
 return <FrameContext.Provider value={{report,actions}}><div data-workspace-shell="true" className={workflow?'studio-workflow-frame':'studio-shell mx-auto md:grid gap-6 px-4 md:px-6 pt-6 pb-28 md:pb-12'} data-linked-detail={linkedDetail}>
 {!workflow&&<aside className="studio-sidebar hidden md:block"><nav className="grid gap-1" aria-label="主导航">{nav.map(([key,label,Icon])=><Button key={key} variant={page===key?'secondary':'ghost'} className="justify-start" aria-current={page===key?'page':undefined} onClick={()=>changePage(key)}><Icon/>{label}</Button>)}</nav></aside>}
 <div role={workflow?undefined:'main'} className={workflow?'min-w-0':'min-w-0 space-y-6'}>{!workflow&&<div className="studio-page-heading flex flex-wrap items-center justify-between gap-2">{page!=='home'&&<h2 className="text-2xl font-semibold">{nav.find(n=>n[0]===page)?.[1]}</h2>}<span className="text-sm text-muted" data-workspace-source>{source}</span></div>}
 {children}
 {!workflow&&page==='settings'&&<div className="space-y-4"><div className="studio-list-group"><GatewaySettings value={gateway} onChange={changeGateway}/></div><div className="studio-list-group"><Button variant="ghost" className="studio-settings-row" onClick={onOpenVersion}><span>软件更新</span><span aria-hidden="true">›</span></Button></div></div>}
 </div>
 {!workflow&&<nav aria-label="移动端主导航" className="safe-nav md:hidden fixed bottom-0 inset-x-0 bg-paper flex gap-1 z-20 pt-1">{nav.map(([key,label,Icon])=><Button key={key} variant="ghost" aria-current={page===key?'page':undefined} className={'flex-col text-xs leading-4 gap-1 '+(page===key?'text-primary font-semibold':'text-muted')} onClick={()=>changePage(key)}><Icon/>{label}</Button>)}</nav>}
 </div></FrameContext.Provider>
}
