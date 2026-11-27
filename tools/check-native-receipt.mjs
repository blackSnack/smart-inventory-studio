import {readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,basename,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeReceiptAcceptance,nativeReceiptPreparationHash} from '../dist/native-receipt-acceptance.js';
import {LocalNativeReceiptEvidence} from './native-receipt-evidence.mjs';
try{
 const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
 const outside=p=>{const rel=relative(root,p);if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('private path outside repository required');return p};
 const input=p=>{const f=outside(realpathSync(p));if(statSync(f).size>16*1024*1024)throw Error('private input too large');return JSON.parse(readFileSync(f,'utf8'))};
 const [mode,...args]=process.argv.slice(2),token=process.env.STUDIO_INVENTREE_ISOLATED_TOKEN;
 if(!token?.trim())throw Error('missing isolated token');
 if(mode==='--prepare'&&args.length===6){
  const [base,instanceId,partId,locationId,q,output]=args;
  if(!/^[1-9][0-9]*$/.test(q))throw Error('invalid quantity');
  const target=outside(resolve(realpathSync(dirname(resolve(output))),basename(output)));
  const prepared=await NativeReceiptAcceptance.open(base,token).prepare(instanceId,{partId,quantity:Number(q),allocations:[{locationId,quantity:Number(q)}]});
  writeFileSync(target,JSON.stringify(prepared,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Private receipt preparation saved; no write performed.');
  console.log('Approval preparation SHA-256: '+await nativeReceiptPreparationHash(prepared));
 }else if(['--execute-isolated-write','--observe-only'].includes(mode)&&args.length===3){
  const prepared=input(args[0]),approval=input(args[1]),directory=outside(realpathSync(args[2]));
  if(!statSync(directory).isDirectory())throw Error('private journal directory required');
  const runner=NativeReceiptAcceptance.open(prepared.base,token),evidence=new LocalNativeReceiptEvidence(directory);
  const result=mode==='--execute-isolated-write'?await runner.execute(prepared,approval,evidence):await runner.observe(prepared,approval,evidence);
  console.log(JSON.stringify(result,null,2));if(result.status!=='verified')process.exitCode=2;
 }else throw Error('explicit acceptance mode and arguments required');
}catch{console.error('Native receipt acceptance stopped. Check local disposable target, explicit approvals, private files and journal. Do not retry an uncertain write; use observe-only.');process.exitCode=1}
