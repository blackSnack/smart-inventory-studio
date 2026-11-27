import {readFileSync,statSync} from 'node:fs';
import {OpenAICompatibleProvider} from '../dist/ai-provider.js';
import {runAIPhotoChallenge} from '../dist/ai-photo-acceptance.js';
try{
 const [flag,base,model,fixture,photo,...rest]=process.argv.slice(2);
 if(flag!=='--allow-network'||!base||!model||!fixture||!photo||rest.length)throw Error('explicit arguments required');
 const key=process.env.STUDIO_AI_KEY;if(!key?.trim())throw Error('missing key');
 const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('HTTPS gateway required');
 if(statSync(fixture).size>256*1024||statSync(photo).size>8_900_000)throw Error('fixture too large');
 const raw=JSON.parse(readFileSync(fixture,'utf8'));
 const bytes=readFileSync(photo);
 if(bytes.length>8_900_000)throw Error('photo too large');
 const type=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
 if(!type)throw Error('unsupported photo');
 const report=await runAIPhotoChallenge(raw,'data:image/'+type+';base64,'+bytes.toString('base64'),new OpenAICompatibleProvider(base,key,model));
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(!report.candidateChecksPassed)process.exitCode=2;
}catch{process.stderr.write('Photo challenge failed: check explicit arguments, HTTPS gateway, key, sanitized public fixture, network or response schema. No retrieval or device verification claimed.\n');process.exitCode=1}
