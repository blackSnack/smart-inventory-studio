import {readFileSync,statSync} from 'node:fs';
import {OpenAIEnrichmentProvider} from '../dist/ai-enrichment-provider.js';
import {runAIEnrichmentChallenge} from '../dist/ai-acceptance.js';
try{
 const [flag,base,model,path,...rest]=process.argv.slice(2);
 if(flag!=='--allow-network'||!base||!model||!path||rest.length)throw Error('explicit arguments required');
 const key=process.env.STUDIO_AI_KEY;if(!key?.trim())throw Error('missing key');
 const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS gateway required');
 if(statSync(path).size>256*1024)throw Error('challenge too large');
 const raw=JSON.parse(readFileSync(path,'utf8'));
 const report=await runAIEnrichmentChallenge(raw,new OpenAIEnrichmentProvider(base,key,model));
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(!report.candidateChecksPassed)process.exitCode=2;
}catch{process.stderr.write('AI challenge failed: check explicit arguments, HTTPS gateway, key, public fixture, network or response schema. No retrieval verification claimed.\n');process.exitCode=1}
