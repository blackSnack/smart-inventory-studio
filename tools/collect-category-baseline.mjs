import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,basename,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectLocalCategoryBaseline} from '../dist/local-category-baseline.js';
try{
 const [flag,base,output,...rest]=process.argv.slice(2);
 if(flag!=='--allow-network'||!base||!output||rest.length)throw Error('explicit arguments required');
 const token=process.env.STUDIO_INVENTREE_READ_TOKEN;
 if(!token?.trim())throw Error('missing read token');
 const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
 const target=resolve(realpathSync(dirname(resolve(output))),basename(output));
 const rel=relative(root,target);
 if(rel===''||(!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&rel!=='..'&&!isAbsolute(rel)))throw Error('private output must be outside repository');
 const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url));
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(readFileSync(new URL('../catalog/SHA256SUMS',import.meta.url),'utf8').trim()!==hash+'  electronic-parts.json')throw Error('catalog hash mismatch');
 const url=new URL(base);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS required for private snapshot');
 const result=await collectLocalCategoryBaseline({base,token},JSON.parse(bytes),hash);
 writeFileSync(target,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('Private category candidate saved. Visibility and field review required; no production approval.');
}catch{console.error('Category baseline failed: check explicit HTTPS URL, read token, existing private destination directory, new output filename, API or catalog. No inventory values or credentials printed.');process.exitCode=1}
