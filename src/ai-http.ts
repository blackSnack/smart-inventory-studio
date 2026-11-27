// Bounded response decoding; credentials and remote error bodies never enter diagnostics.
export function assertAIActive(signal?:AbortSignal):void{
 if(signal?.aborted)throw Error(signal.reason?.name==='TimeoutError'?'AI request timed out':'AI request cancelled');
}
export async function completionJSON(response:Response):Promise<unknown>{
 if(!response.ok)throw Error('AI HTTP '+response.status);
 const limit=512*1024,declared=response.headers.get('content-length');
 if(declared!==null&&Number(declared)>limit){await response.body?.cancel();throw Error('AI response too large')}
 if(!response.body)throw Error('empty AI response');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,raw='';
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>limit)throw Error('AI response too large');raw+=decoder.decode(chunk.value,{stream:true})}raw+=decoder.decode()}finally{try{await reader.cancel()}catch{}reader.releaseLock()}
 let payload;try{payload=JSON.parse(raw)}catch{throw Error('invalid AI response')}
 const choice=payload?.choices?.[0],content=choice?.message?.content;
 if((choice?.finish_reason!=null&&choice.finish_reason!=='stop')||typeof content!=='string'||content.length>100000)throw Error('invalid or incomplete AI response');
 try{return JSON.parse(content)}catch{throw Error('invalid AI JSON')}
}
