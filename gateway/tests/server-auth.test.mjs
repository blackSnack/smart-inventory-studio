import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {request} from 'node:https';
import {createGateway} from '../src/server.mjs';
import {loadConfig} from '../src/config.mjs';

const openssl=process.env.GATEWAY_TEST_OPENSSL||process.env.GATEWAY_OPENSSL||(process.platform==='win32'?'openssl.exe':'openssl');
function run(directory,args){execFileSync(openssl,args,{cwd:directory,stdio:'pipe',windowsHide:true})}
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'gateway-auth-'));
  await writeFile(join(directory,'root.cnf'),'[req]\ndistinguished_name=dn\nprompt=no\nx509_extensions=ca\n[dn]\nCN=Gateway Auth Test CA\n[ca]\nbasicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
  await writeFile(join(directory,'leaf.cnf'),'[leaf]\nbasicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
  run(directory,['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout','ca.key','-out','ca.crt','-config','root.cnf']);
  run(directory,['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=Gateway Auth Test','-keyout','server.key','-out','server.csr']);
  run(directory,['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-days','1','-out','server.crt','-extfile','leaf.cnf','-extensions','leaf']);
  const configPath=join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({host:'127.0.0.1',port:8443,dataDir:'./data',tls:{cert:'server.crt',key:'server.key'}}));
  return {directory,config:await loadConfig(configPath),ca:await readFile(join(directory,'ca.crt'))};
}
function call(port,path,{method='GET',body,headers={},ca}={}){
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    const req=request({host:'127.0.0.1',port,path,method,ca,timeout:5000,headers:{
      'Connection':'close',...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{}),...headers
    }},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const raw=Buffer.concat(chunks).toString('utf8');
        try{resolve({status:res.statusCode,body:raw?JSON.parse(raw):null,headers:res.headers})}
        catch(error){reject(error)}
      });
    });
    req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}

test('setup, login, CSRF, redacted upstream settings and logout are enforced over HTTPS',async t=>{
  const f=await fixture(t),server=await createGateway(f.config);
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await rm(f.directory,{recursive:true,force:true});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,f.config.host,resolve)});
  const port=server.address().port,origin='https://127.0.0.1:'+port;
  const status=await call(port,'/api/v1/setup/status',{ca:f.ca});
  assert.deepEqual(status.body,{required:true});
  const token=(await readFile(server.gatewaySetupTokenPath,'utf8')).trim();
  const crossOrigin=await call(port,'/api/v1/auth/login',{method:'POST',body:{password:'irrelevant'},headers:{Origin:'https://attacker.example'},ca:f.ca});
  assert.equal(crossOrigin.status,403);
  const setup=await call(port,'/api/v1/setup',{method:'POST',body:{setupToken:token,password:'a-long-local-admin-password'},headers:{Origin:origin},ca:f.ca});
  assert.equal(setup.status,201);
  const cookie=setup.headers['set-cookie'][0].split(';')[0],firstCsrf=setup.body.csrfToken;
  assert.ok(cookie.startsWith('gateway_session='));
  assert.equal((await call(port,'/api/v1/admin/connections',{ca:f.ca})).status,401);
  const before=await call(port,'/api/v1/admin/connections',{headers:{Cookie:cookie},ca:f.ca});
  assert.equal(before.status,200);
  assert.equal(before.body.inventree.token,undefined);
  const noCsrf=await call(port,'/api/v1/admin/connections/inventree',{method:'PUT',body:{baseUrl:'https://inventory.example/api',token:'secret'},headers:{Origin:origin,Cookie:cookie},ca:f.ca});
  assert.equal(noCsrf.status,403);
  const saved=await call(port,'/api/v1/admin/connections/inventree',{method:'PUT',body:{baseUrl:'https://inventory.example/api',token:'inventory-secret'},headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':firstCsrf},ca:f.ca});
  assert.equal(saved.status,200);
  assert.equal(saved.body.connection.tokenConfigured,true);
  assert.equal(saved.body.connection.token,undefined);
  const insecure=await call(port,'/api/v1/admin/connections/ai',{method:'PUT',body:{baseUrl:'http://agent.example/v1',apiKey:'secret',model:'vision'},headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':firstCsrf},ca:f.ca});
  assert.equal(insecure.status,400);
  const refreshed=await call(port,'/api/v1/auth/session',{headers:{Cookie:cookie},ca:f.ca});
  assert.equal(refreshed.body.authenticated,true);
  assert.notEqual(refreshed.body.csrfToken,firstCsrf);
  const stale=await call(port,'/api/v1/auth/logout',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':firstCsrf},ca:f.ca});
  assert.equal(stale.status,403);
  const logout=await call(port,'/api/v1/auth/logout',{method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':refreshed.body.csrfToken},ca:f.ca});
  assert.equal(logout.status,200);
  assert.equal((await call(port,'/api/v1/auth/session',{headers:{Cookie:cookie},ca:f.ca})).body.authenticated,false);
  const login=await call(port,'/api/v1/auth/login',{method:'POST',body:{password:'a-long-local-admin-password'},headers:{Origin:origin},ca:f.ca});
  assert.equal(login.status,200);
  const secondCookie=login.headers['set-cookie'][0].split(';')[0];
  const bad=await call(port,'/api/v1/admin/connections',{headers:{Cookie:secondCookie},ca:f.ca});
  assert.equal(bad.status,200);
});
