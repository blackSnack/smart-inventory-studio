import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {catalogCoverage} from '../dist/catalog-coverage.js';
try{
 if(process.argv.length!==3)throw Error('usage: node tools/catalog-coverage.mjs <private aggregate.json>');
 const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)),hash=createHash('sha256').update(bytes).digest('hex');
 const manifest=readFileSync(new URL('../catalog/SHA256SUMS',import.meta.url),'utf8').trim();
 if(manifest!==hash+'  electronic-parts.json')throw Error('catalog SHA-256 mismatch');
 const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
 process.stdout.write(JSON.stringify(catalogCoverage(JSON.parse(bytes),hash,input),null,2)+'\n');
}catch{process.stderr.write('Coverage report failed: check usage, catalog hash/version and anonymous aggregate schema. No inventory data was written.\n');process.exitCode=1}
