import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reviewCatalogFreeze} from '../dist/catalog-freeze-review.js';
try{
 if(process.argv.length!==3||statSync(process.argv[2]).size>32*1024*1024)throw Error('explicit private review file required');
 const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)),hash=createHash('sha256').update(bytes).digest('hex');
 if(readFileSync(new URL('../catalog/SHA256SUMS',import.meta.url),'utf8').trim()!==hash+'  electronic-parts.json')throw Error('catalog hash mismatch');
 const result=reviewCatalogFreeze(JSON.parse(bytes),hash,JSON.parse(readFileSync(process.argv[2],'utf8')));
 console.log(JSON.stringify(result,null,2));
 if(result.status!=='proposal-ready')process.exitCode=2;
}catch{console.error('Freeze review failed: check private review schema, catalog version/hash and evidence. No approval or catalog changes made.');process.exitCode=1}
