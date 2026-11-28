import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../src/config.mjs';

async function fixture(t,value) {
  const directory=await mkdtemp(join(tmpdir(),'gateway-config-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'config.json');
  await writeFile(path,JSON.stringify(value));
  return {directory,path};
}

test('loads local CA mode with a private persistent data directory',async t=>{
  const f=await fixture(t,{host:'127.0.0.1',port:8443,dataDir:'./state',tls:{mode:'local-ca',renewBeforeDays:30,opensslPath:'./runtime/openssl.exe',opensslConfigPath:'./runtime/openssl.cnf'}});
  const config=await loadConfig(f.path);
  assert.equal(config.tls.mode,'local-ca');
  assert.equal(config.dataDir,join(f.directory,'state'));
  assert.equal(config.tls.renewBeforeDays,30);
  assert.equal(config.tls.opensslPath,join(f.directory,'runtime/openssl.exe'));
  assert.equal(config.tls.opensslConfigPath,join(f.directory,'runtime/openssl.cnf'));
});

test('preserves the supplied-certificate configuration contract',async t=>{
  const f=await fixture(t,{host:'::1',port:9443,tls:{cert:'./tls/server.crt',key:'./tls/server.key'}});
  const config=await loadConfig(f.path);
  assert.equal(config.tls.mode,'provided');
  assert.equal(config.tls.cert,join(f.directory,'tls/server.crt'));
  assert.equal(config.tls.key,join(f.directory,'tls/server.key'));
});

test('allows explicit private interface addresses but rejects public, link-local and wildcard binds',async t=>{
  for(const host of ['127.0.0.1','::1','10.12.0.8','172.31.255.254','192.168.1.20','fd12:3456::1']){
    const f=await fixture(t,{host,port:8443,tls:{mode:'local-ca'}});
    assert.equal((await loadConfig(f.path)).host,host);
  }
  for(const host of ['0.0.0.0','::','8.8.8.8','169.254.1.2','fe80::1','ff02::1','2001:4860:4860::8888','localhost']){
    const f=await fixture(t,{host,port:8443,tls:{mode:'local-ca'}});
    await assert.rejects(loadConfig(f.path));
  }
});

test('rejects invalid local CA settings and unknown configuration keys',async t=>{
  const cases=[
    {host:'0.0.0.0',port:8443,tls:{mode:'local-ca'}},
    {host:'127.0.0.1',port:8443,tls:{mode:'unknown'}},
    {host:'127.0.0.1',port:8443,tls:{mode:'local-ca',cert:'server.crt'}},
    {host:'127.0.0.1',port:8443,tls:{mode:'local-ca',renewBeforeDays:0}},
    {host:'127.0.0.1',port:8443,tls:{mode:'local-ca',unexpected:true}},
    {host:'127.0.0.1',port:8443,unexpected:true,tls:{mode:'local-ca'}}
  ];
  for(const value of cases){
    const f=await fixture(t,value);
    await assert.rejects(loadConfig(f.path));
  }
});
