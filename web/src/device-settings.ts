// Explicitly saved device-local preferences. No credentials in localStorage.
// Non-extractable CryptoKey is stored alongside ciphertext in IndexedDB: this
// prevents plaintext at rest, NOT access by malicious same-origin JavaScript.
export type ProfileKind='inventory'|'gateway';
export type Profile={url:string;model:string;local:boolean;secret:string;remember:boolean};
type RecordV1={version:1;url:string;model:string;local:boolean;sealed?:{key:CryptoKey;iv:Uint8Array<ArrayBuffer>;data:ArrayBuffer}};
const blank=():Profile=>({url:'',model:'',local:false,secret:'',remember:false});
export function validServiceUrl(value:string){try{const u=new URL(value.trim());return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash?u:null}catch{return null}}
function db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const req=indexedDB.open('smart-inventory-studio-settings-v1:'+new URL('.',location.href).pathname,1);
 req.onupgradeneeded=()=>req.result.createObjectStore('profiles');
 let rejected=false;req.onblocked=()=>{rejected=true;reject(Error('settings storage blocked'))};req.onerror=()=>reject(Error('settings storage unavailable'));req.onsuccess=()=>{if(rejected){req.result.close();return}resolve(req.result)};
})}
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 const database=await db();try{return await new Promise<T>((resolve,reject)=>{const tx=database.transaction('profiles',mode);const req=run(tx.objectStore('profiles'));tx.oncomplete=()=>resolve(req.result);tx.onerror=tx.onabort=()=>reject(Error('settings storage operation failed'))})}finally{database.close()}
}
export async function loadProfile(kind:ProfileKind):Promise<Profile>{
 const raw=await transaction('readonly',store=>store.get(kind)) as RecordV1|undefined;if(raw===undefined)return blank();
 if(raw.version!==1||typeof raw.url!=='string'||raw.url&&!validServiceUrl(raw.url)||typeof raw.model!=='string'||typeof raw.local!=='boolean')throw Error('invalid settings');
 let secret='';if(raw.sealed){const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.sealed.iv,additionalData:new TextEncoder().encode(JSON.stringify([kind,raw.url,raw.model,raw.local]))},raw.sealed.key,raw.sealed.data);secret=new TextDecoder('utf-8',{fatal:true}).decode(data)}
 return {url:raw.url,model:raw.model,local:raw.local,secret,remember:!!raw.sealed};
}
export async function saveProfile(kind:ProfileKind,p:Profile):Promise<void>{
 const url=p.url.trim(),model=kind==='gateway'?p.model.trim():'',local=kind==='inventory'&&p.local;
 if(url&&!validServiceUrl(url)||url.length>2048||model.length>512||p.secret.length>16384)throw Error('invalid settings');
 const record:RecordV1={version:1,url,model,local};
 if(p.remember&&p.secret){if(!url)throw Error('missing service address');const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(JSON.stringify([kind,url,model,local]))},key,new TextEncoder().encode(p.secret));record.sealed={key,iv,data}}
 await transaction('readwrite',store=>store.put(record,kind));
}
export async function clearProfileSecret(kind:ProfileKind){
 const database=await db();try{await new Promise<void>((resolve,reject)=>{const tx=database.transaction('profiles','readwrite');const store=tx.objectStore('profiles');const r=store.get(kind);r.onsuccess=()=>{if(r.result){const {sealed:_,...metadata}=r.result;store.put(metadata,kind)}};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('clear saved credential failed'))})}finally{database.close()}
}
export function connectionDiagnostic(error:unknown,address:string,local:boolean,secure:boolean):string{
 const url=validServiceUrl(address);if(!url)return '服务地址无效。请输入完整 HTTP 或 HTTPS 地址，不要在地址中包含凭据、查询参数或片段。';
 const msg=error instanceof Error?error.message:'';
 const status=/^HTTP (\d{3})$/.exec(msg)?.[1];
 if(status==='401')return '服务返回 HTTP 401：Token 无效、已过期或未提供正确认证。';
 if(status==='403')return '服务返回 HTTP 403：账号或 Token 缺少读取库位的权限。';
 if(status==='404')return '服务返回 HTTP 404：未找到库存 API。请核对 InvenTree 根地址及反向代理路径。';
 if(status)return '服务返回 HTTP '+status+'，请检查 InvenTree 服务状态及反向代理。';
 if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return '连接超时。请确认设备能够访问库存服务、端口和本地网络。';
 if(error instanceof TypeError){
  if(secure&&url.protocol==='http:')return local?'浏览器未取得 HTTP 本地服务响应。请确认允许本地网络访问、域名解析到局域网地址且 CORS 允许当前站点；若浏览器不支持该连接方式，请配置 HTTPS。':'HTTPS 页面访问 HTTP 库存服务可能被浏览器拦截。局域网服务可尝试启用本地网络访问并授权；推荐使用 HTTPS 和正确的 CORS 白名单。';
  return '浏览器未取得服务响应：可能是 DNS、网络、TLS 证书、CORS 或本地网络权限。浏览器未提供可确认的 HTTP 状态。';
 }
 if(msg==='invalid configuration')return '服务地址或 Token 配置不完整。';
 return '库存 API 响应无法验证，请检查 InvenTree 版本、API 路径和库位数据。未建立连接。';
}
