// Bounded response decoding; credentials and remote error bodies never enter diagnostics.
export function assertAIActive(signal?:AbortSignal):void{
 if(signal?.aborted)throw Error(signal.reason?.name==='TimeoutError'?'AI request timed out':'AI request cancelled');
}
export function awaitAI<T>(pending:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return pending;
 return new Promise<T>((resolve,reject)=>{
  const abort=()=>{try{assertAIActive(signal)}catch(e){reject(e)}};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  pending.then(v=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolve(v)},e=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else reject(e)});
 });
}
export async function requestAI(request:typeof fetch,url:URL,init:RequestInit,signal:AbortSignal){
 assertAIActive(signal);
 try{
  const pending=request(url,init);
  pending.then(r=>{if(signal.aborted)void r.body?.cancel().catch(()=>{})},()=>{});
  return await awaitAI(pending,signal);
 }catch{assertAIActive(signal);throw Error('AI transport unavailable')}
}
export async function completionJSON(response:Response,signal?:AbortSignal):Promise<unknown>{
 const discard=()=>{void response.body?.cancel().catch(()=>{})};
 if(signal?.aborted){discard();assertAIActive(signal)}
 if(!response.ok){discard();throw Error('AI HTTP '+response.status)}
 const limit=512*1024,declared=response.headers.get('content-length');
 if(declared!==null&&Number(declared)>limit){discard();throw Error('AI response too large')}
 if(!response.body)throw Error('empty AI response');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
 try{while(true){const chunk=await awaitAI(reader.read(),signal);if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit)throw Error('AI response too large');raw+=decoder.decode(chunk.value,{stream:true})}raw+=decoder.decode()}finally{try{void reader.cancel().catch(()=>{})}catch{}reader.releaseLock()}
 assertAIActive(signal);
 let payload;try{payload=JSON.parse(raw)}catch{throw Error('invalid AI response')}
 const choice=payload?.choices?.[0],message=choice?.message,content=message?.content;
 if(!Array.isArray(payload?.choices)||payload.choices.length!==1||(choice?.finish_reason!=null&&choice.finish_reason!=='stop')||(message?.role!=null&&message.role!=='assistant')||message?.refusal||message?.tool_calls!=null||message?.function_call!=null||typeof content!=='string'||content.length>100000)throw Error('invalid or incomplete AI response');
 try{return JSON.parse(content)}catch{throw Error('invalid AI JSON')}
}
