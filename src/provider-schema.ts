export type RequiredOperation={key:string;path:string;method:'get'|'post'|'patch'|'put'|'delete'};
export type SchemaEvidence={key:string;path:string;method:string;declared:boolean};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function inspectSchema(schema:unknown,required:RequiredOperation[]):SchemaEvidence[]{
 if(!object(schema)||typeof schema.openapi!=='string'||!schema.openapi.startsWith('3.')||!object(schema.paths))throw Error('invalid OpenAPI schema');
 if(new Set(required.map(x=>x.key)).size!==required.length)throw Error('duplicate capability key');const paths=schema.paths;
 return required.map(r=>{if(!r.path.startsWith('/api/')||!['get','post','patch','put','delete'].includes(r.method))throw Error('invalid operation');const p=paths[r.path];return {...r,declared:object(p)&&object(p[r.method])}});
}
export async function probeSchema(base:string,token:string,required:RequiredOperation[],request:typeof fetch=fetch){
 const b=new URL(base.endsWith('/')?base:base+'/');if(!['http:','https:'].includes(b.protocol)||b.username||b.password||b.search||b.hash||!token.trim())throw Error('invalid provider configuration');
 const u=new URL('api/schema/',b);u.searchParams.set('format','json');const r=await request(u,{method:'GET',headers:{Authorization:'Token '+token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('schema HTTP '+r.status);const raw=await r.text();if(raw.length>16*1024*1024)throw Error('schema too large');
 const schema=JSON.parse(raw);return {operations:inspectSchema(schema,required),runtimeVerified:false as const,writeEnabled:false as const};
}
