export interface ReleaseEntry {version:string;title:string;changes:string[]}
export interface ReleaseManifest {version:string;commit:string|null;history:ReleaseEntry[]}
const re=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const valid=(v:unknown):v is string=>typeof v==='string'&&v.length<=48&&re.test(v);
export function compareVersions(a:string,b:string){if(!valid(a)||!valid(b))throw Error('invalid version');const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]?1:-1}return 0}
export function parseReleaseManifest(raw:unknown):ReleaseManifest{
 const m=raw as ReleaseManifest;if(!m||typeof m!=='object'||!valid(m.version)||!(m.commit===null||typeof m.commit==='string'&&/^[a-f0-9]{40}$/.test(m.commit))||!Array.isArray(m.history)||!m.history.length||m.history.length>200||m.history[0]?.version!==m.version)throw Error('invalid version manifest');
 for(const [i,e] of m.history.entries())if(!e||!valid(e.version)||typeof e.title!=='string'||!e.title.trim()||!Array.isArray(e.changes)||!e.changes.length||e.changes.some(c=>typeof c!=='string'||!c.trim())||(i>0&&compareVersions(m.history[i-1].version,e.version)<=0))throw Error('invalid release history');return m;
}
export function changesSince(current:string,m:ReleaseManifest){return m.history.filter(e=>compareVersions(e.version,current)>0)}
export async function fetchReleaseManifest(request:typeof fetch=fetch):Promise<ReleaseManifest>{const url=new URL('./version.json',document.baseURI);url.searchParams.set('t',String(Date.now()));const r=await request(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('version HTTP '+r.status);const s=await r.text();if(s.length>256000)throw Error('version response too large');return parseReleaseManifest(JSON.parse(s))}
