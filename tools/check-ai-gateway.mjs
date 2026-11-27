import {readFileSync,statSync} from 'node:fs';
import {OpenAICompatibleProvider} from '../dist/ai-provider.js';
import {OpenAIEnrichmentProvider} from '../dist/ai-enrichment-provider.js';
import {runAIEnrichmentChallenge,runAIPhotoChallenge,runAIFreshSourceChallenge} from '../dist/ai-acceptance.js';
try{
 const [flag,base,model,path,...rest]=process.argv.slice(2);
 if(!['--allow-network','--allow-network-photo','--allow-network-fresh-source'].includes(flag)||!base||!model||!path||rest.length!==(flag==='--allow-network-photo'?1:0))throw Error('explicit arguments required');
 const key=process.env.STUDIO_AI_KEY;if(!key?.trim())throw Error('missing key');
 const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS gateway required');
 if(statSync(path).size>256*1024)throw Error('challenge too large');
 const raw=JSON.parse(readFileSync(path,'utf8'));
 let report;
 if(flag==='--allow-network-photo'){
  if(statSync(rest[0]).size>8*1024*1024)throw Error('photo too large');
  const bytes=readFileSync(rest[0]);if(bytes.length>8*1024*1024)throw Error('photo too large');
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP'?'webp':null;
  if(!mime)throw Error('unsupported photo');
  report=await runAIPhotoChallenge(raw,'data:image/'+mime+';base64,'+bytes.toString('base64'),new OpenAICompatibleProvider(base,key,model));
 }else{
  const provider=new OpenAIEnrichmentProvider(base,key,model);
  report=await (flag==='--allow-network-fresh-source'?runAIFreshSourceChallenge(raw,provider):runAIEnrichmentChallenge(raw,provider));
 }
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(!report.candidateChecksPassed)process.exitCode=2;
}catch{process.stderr.write('AI challenge failed: check explicit arguments, HTTPS gateway, key, public fixture, network or response schema. No retrieval verification claimed.\n');process.exitCode=1}
