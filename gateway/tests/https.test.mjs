import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {request} from 'node:https';
import {createGateway} from '../src/server.mjs';
import {loadConfig} from '../src/config.mjs';

const openssl = process.env.GATEWAY_TEST_OPENSSL || 'openssl';
function run(dir,args) {execFileSync(openssl,args,{cwd:dir,stdio:'pipe',windowsHide:true});}
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'gateway-tls-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'root.cnf'),'[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ca\n[dn]\nCN=Synthetic Gateway Test CA\n[ca]\nbasicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
  await writeFile(join(dir,'leaf.cnf'),'[leaf]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
  run(dir,['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout','ca.key','-out','ca.crt','-config','root.cnf']);
  run(dir,['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=Gateway Test','-keyout','server.key','-out','server.csr']);
  run(dir,['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','1','-out','server.crt','-extfile','leaf.cnf','-extensions','leaf']);
  await writeFile(join(dir,'client-only.cnf'),'[client]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\nsubjectAltName=IP:127.0.0.1\n');
  run(dir,['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAserial','ca.srl','-days','1','-out','client-only.crt','-extfile','client-only.cnf','-extensions','client']);
  const file=join(dir,'config.json');
  const raw={host:'127.0.0.1',port:8443,tls:{cert:'server.crt',key:'server.key'}};
  await writeFile(file,JSON.stringify(raw));
  return {dir,file,raw,config:await loadConfig(file),ca:await readFile(join(dir,'ca.crt')),clientOnlyCert:join(dir,'client-only.crt')};
}
function get(port,path,ca,method='GET') {
  return new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path,method,ca,timeout:5000},res=>{
      let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data),headers:res.headers}));
      res.on('error',reject);
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('timeout')));req.end();
  });
}
test('trusted local HTTPS, rejects unknown CA and business routes across server restarts',async t=>{
  const f=await fixture(t);
  for(let i=0;i<2;i++){
    const server=await createGateway(f.config);
    try {
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,f.config.host,resolve);});
      const port=server.address().port;
      const ok=await get(port,'/api/v1/health',f.ca);
      assert.equal(ok.status,200);assert.deepEqual(ok.body,{service:'smart-inventory-gateway',apiVersion:1,status:'ok'});
      assert.equal(ok.headers['cache-control'],'no-store');
      await assert.rejects(get(port,'/api/v1/health',undefined));
      assert.equal((await get(port,'/api/v1/parts',f.ca)).status,404);
      assert.equal((await get(port,'/api/v1/health',f.ca,'POST')).status,404);
    } finally {await new Promise(resolve=>server.close(resolve));}
  }
});
test('invalid configuration and TLS fail closed',async t=>{
  const f=await fixture(t);
  await assert.rejects(createGateway({...f.config,host:'0.0.0.0'}),/LAN binding/);
  await assert.rejects(createGateway({...f.config,host:'::1'}),/wrong IP SAN/);
  await assert.rejects(createGateway({...f.config,tls:{...f.config.tls,key:join(f.dir,'ca.key')}}),/invalid or mismatched/);
  await assert.rejects(createGateway({...f.config,tls:{...f.config.tls,cert:join(f.dir,'missing.crt')}}),/TLS certificate or private key is missing/);
  await assert.rejects(createGateway({...f.config,tls:{...f.config.tls,cert:f.clientOnlyCert}}),/does not permit TLS server authentication/);
  await writeFile(f.file,JSON.stringify({...f.raw,host:'0.0.0.0'}));
  await assert.rejects(loadConfig(f.file),/Invalid Gateway configuration/);
  await writeFile(f.file,JSON.stringify({...f.raw,port:0}));
  await assert.rejects(loadConfig(f.file),/Invalid Gateway configuration/);
  await writeFile(f.file,'not json');
  await assert.rejects(loadConfig(f.file),/Invalid or unreadable/);
});
