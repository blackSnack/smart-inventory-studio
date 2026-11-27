// Explicit local acceptance context, separate from the fixture and PWA entry points.
const contexts=new WeakSet<object>();
export interface LocalOperationContext {readonly base:string;readonly token:string;readonly instanceId:string;readonly request:typeof fetch}
export function localOperationBase(base:string){
 const u=new URL(base);
 if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('explicit loopback disposable instance with port required');
 return u;
}
// The supplied dispatcher owns the read/write mode, exact operation allowlist and durable claim.
export function createLocalOperationContext(base:string,token:string,instanceId:string,dispatcher:typeof fetch):LocalOperationContext{
 const u=localOperationBase(base);
 if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token)||typeof instanceId!=='string'||!instanceId.trim()||instanceId.length>256||typeof dispatcher!=='function')throw Error('invalid local acceptance context');
 const request:typeof fetch=(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))throw Error('invalid local request');
  const target=new URL(input,u);
  if(target.origin!==u.origin||target.username||target.password||target.hash||!['GET','POST','PATCH'].includes(init?.method??'GET'))throw Error('unsafe local acceptance request');
  return dispatcher(target,{...init,redirect:'error',cache:'no-store'});
 };
 const ctx=Object.freeze({base:u.href,token,instanceId,request});
 contexts.add(ctx);return ctx;
}
export function assertLocalOperationContext(ctx:LocalOperationContext,evidence?:{base:string;instanceId:string}){
 if(!ctx||!contexts.has(ctx))throw Error('explicit local acceptance context required');
 localOperationBase(ctx.base);
 if(evidence&&(evidence.base!==ctx.base||evidence.instanceId!==ctx.instanceId))throw Error('local evidence scope mismatch');
}
