#!/usr/bin/env node
// Explicit local-only command. Never invoked by the PWA or CI against a real host.
import {collectInvenTreeEvidence} from '../dist/inventree-contract-evidence.js';
try{
 const [base,...flags]=process.argv.slice(2),samples={};
 if(!base||flags.length%2)throw Error('invalid arguments');
 for(let i=0;i<flags.length;i+=2){const m=/^--(part|category|template|parameter|location)-id$/.exec(flags[i]);if(!m||Object.hasOwn(samples,m[1]))throw Error('invalid sample');samples[m[1]]=flags[i+1]}
 const token=process.env.STUDIO_INVENTREE_READ_TOKEN;
 if(!token?.trim())throw Error('missing token');
 const report=await collectInvenTreeEvidence({base,token,samples});
 console.log(JSON.stringify(report,null,2));
 if(report.version!=='target-match'||!report.authenticatedRead||!report.schema.contract)process.exitCode=2;
}catch{console.error('Probe failed: check explicit URL, read-only token, sample IDs and existing build. No credentials or response body printed.');process.exitCode=1}
