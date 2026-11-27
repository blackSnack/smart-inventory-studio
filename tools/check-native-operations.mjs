import {readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,basename,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NativeOperationsAcceptance,nativeOperationsPreparationHash} from '../dist/native-operations-acceptance.js';
import {LocalNativeOperationEvidence} from './native-operation-evidence.mjs';
try{
 const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
 const outside=p=>{const rel=relative(root,p);if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('private path outside repository required');return p};
 const input=p=>{const f=outside(realpathSync(p));if(statSync(f).size>32*1024*1024)throw Error('private input too large');return JSON.parse(readFileSync(f,'utf8'))};
 const [mode,...args]=process.argv.slice(2),token=process.env.STUDIO_INVENTREE_ISOLATED_TOKEN;
 if(!token?.trim())throw Error('missing isolated token');
 const bytes=readFileSync(new URL('../catalog/electronic-parts.json',import.meta.url)),hash=createHash('sha256').update(bytes).digest('hex');
 if(readFileSync(new URL('../catalog/SHA256SUMS',import.meta.url),'utf8').trim()!==hash+'  electronic-parts.json')throw Error('catalog hash mismatch');
 const runner=base=>NativeOperationsAcceptance.open(base,token,JSON.parse(bytes),hash);
 if(mode==='--prepare'&&args.length===4){
  const [base,instanceId,fields,output]=args,target=outside(resolve(realpathSync(dirname(resolve(output))),basename(output)));
  const prepared=await runner(base).prepare(instanceId,input(fields));
  const content=JSON.stringify(prepared,null,2)+'\n';if(Buffer.byteLength(content)>32*1024*1024)throw Error('private preparation exceeds limit');
  writeFileSync(target,content,{flag:'wx',mode:0o600});
  console.log('Private operation preparation saved; no mutation performed.');
  console.log('Approval preparation SHA-256: '+await nativeOperationsPreparationHash(prepared));
 }else if(['--execute-isolated-write','--observe-only'].includes(mode)&&args.length===3){
  const prepared=input(args[0]),approval=input(args[1]),directory=outside(realpathSync(args[2]));
  if(!statSync(directory).isDirectory())throw Error('private journal directory required');
  const service=runner(prepared.base),evidence=new LocalNativeOperationEvidence(directory);
  const result=mode==='--execute-isolated-write'?await service.execute(prepared,approval,evidence):await service.observe(prepared,approval,evidence);
  console.log(JSON.stringify(result,null,2));if(result.status!=='verified')process.exitCode=2;
 }else throw Error('explicit acceptance mode and arguments required');
}catch{console.error('Native operation stopped. Check local disposable target, explicit approvals, private files and journal. Never regenerate or retry an uncertain operation; use observe-only.');process.exitCode=1}
