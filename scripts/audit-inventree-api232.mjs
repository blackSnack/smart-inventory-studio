// Offline contract verification only. No HTTP, credentials or authorization side effects.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('../docs/verification/inventree-api232-schema-audit.json',import.meta.url),'utf8'));
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function resolve(root,node,seen=new Set()){
 if(!obj(node))return null;
 if(typeof node.$ref==='string'){
  if(!node.$ref.startsWith('#/')||seen.has(node.$ref))return null;
  let value=root;for(const p of node.$ref.slice(2).split('/'))value=obj(value)?value[p.replace(/~1/g,'/').replace(/~0/g,'~')]:undefined;
  const resolved=resolve(root,value,new Set([...seen,node.$ref]));return resolved?{...resolved,...Object.fromEntries(Object.entries(node).filter(([k])=>k!=='$ref'))}:null;
 }
 if(Array.isArray(node.allOf)){
  const parts=node.allOf.map(n=>resolve(root,n,seen));if(parts.some(n=>!n))return null;
  const all=[...parts,node];return {...Object.assign({},...all),properties:Object.assign({},...all.map(n=>n.properties??{})),required:[...new Set(all.flatMap(n=>Array.isArray(n.required)?n.required:[]))]};
 }
 return node;
}
function field(root,shape,path,write){
 let s=resolve(root,shape);
 for(const segment of path.split('.')){
  if(!obj(s?.properties))return {status:'unknown'};
  const array=segment.endsWith('[]'),key=array?segment.slice(0,-2):segment;
  if(!Object.hasOwn(s.properties,key))return {status:'missing'};
  s=resolve(root,s.properties[key]);if(!s)return {status:'unknown'};
  if(write?s.readOnly===true:s.writeOnly===true)return {status:'wrong-access'};
  if(array){s=resolve(root,s.items);if(!s)return {status:'unknown'}}
 }
 return {status:'declared',type:s?.type??null,format:s?.format??null,nullable:s?.nullable===true};
}
function getShape(root,op,write,list,media){
 if(write)return resolve(root,resolve(root,op.requestBody)?.content?.[media]?.schema);
 for(const code of Object.keys(op.responses??{}).filter(k=>/^2\d\d$/.test(k)).sort()){
  const s=resolve(root,resolve(root,op.responses[code])?.content?.['application/json']?.schema);
  if(!s)continue;
  if(!list)return s;
  const row=s.type==='array'?resolve(root,s.items):resolve(root,resolve(root,s.properties?.results)?.items);
  if(row)return row;
 }
 return null;
}
const lists=new Set(['part-list','category-list','template-list','category-bindings','parameters','manufacturer-parts','supplier-parts','attachments','stock-list','location-list']);
export function auditApi232(schema,specs=manifest.checks){
 if(!obj(schema)||typeof schema.openapi!=='string'||!schema.openapi.startsWith('3.')||!obj(schema.paths)||String(schema.info?.version)!=='232')throw Error('expected OpenAPI 3 / API version 232');
 const checks=specs.map(spec=>{
  const write=spec.method!=='GET',path=schema.paths[spec.path],op=path?.[spec.method.toLowerCase()];
  const media=['image-attachment-create','part-image-update'].includes(spec.key)?'multipart/form-data':'application/json';
  const shape=obj(op)?getShape(schema,op,write,lists.has(spec.key),media):null;
  const fields=Object.fromEntries(Object.keys(spec.fields).map(k=>[k,field(schema,shape,k,write)]));
  const params=[...(Array.isArray(path?.parameters)?path.parameters:[]),...(Array.isArray(op?.parameters)?op.parameters:[])].map(n=>resolve(schema,n));
  const query=Object.fromEntries(Object.keys(spec.query).map(k=>[k,params.some(n=>n?.in==='query'&&n.name===k)?'declared':'not-in-schema']));
  const extraRequired=write&&Array.isArray(shape?.required)?shape.required.filter(k=>!Object.hasOwn(spec.fields,k)&&resolve(schema,shape.properties?.[k])?.readOnly!==true):[];
  const declared=obj(op),payloadSchemaAvailable=!!shape;
  const gaps=!declared||!payloadSchemaAvailable||Object.values(fields).some(x=>x.status!=='declared')||Object.values(query).some(x=>x!=='declared')||extraRequired.length>0;
  return {key:spec.key,method:spec.method,path:spec.path,declared,payloadSchemaAvailable,media,fields,query,extraRequired,gaps};
 });
 return {apiVersion:232,pathCount:Object.keys(schema.paths).length,checked:checks.length,declared:checks.filter(x=>x.declared).length,withGaps:checks.filter(x=>x.gaps).length,checks,runtimeVerified:false,writeEnabled:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==3)throw Error('usage: node scripts/audit-inventree-api232.mjs <local-schema.json>');
  const bytes=readFileSync(process.argv[2]);if(bytes.length>16*1024*1024)throw Error('schema too large');
  const report=auditApi232(JSON.parse(bytes.toString('utf8')));
  console.log(JSON.stringify({...report,schemaSha256:createHash('sha256').update(bytes).digest('hex')},null,2));
  if(report.withGaps)process.exitCode=2;
 }catch(error){console.error(error.message);process.exitCode=1}
}
