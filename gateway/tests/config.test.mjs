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
  const f=await fixture(t,{host:'127.0.0.1',port:8443,dataDir:'./state',tls:{mode:'local-ca',renewBeforeDays:30}});
  const config=await loadConfig(f.path);
  assert.equal(config.tls.mode,'local-ca');
  assert.equal(config.dataDir,join(f.directory,'state'));
  assert.equal(config.tls.renewBeforeDays,30);
});

test('preserves the supplied-certificate configuration contract',async t=>{
  const f=await fixture(t,{host:'::1',port:9443,tls:{cert:'./tls/server.crt',key:'./tls/server.key'}});
  const config=await loadConfig(f.path);
  assert.equal(config.tls.mode,'provided');
  assert.equal(config.tls.cert,join(f.directory,'tls/server.crt'));
  assert.equal(config.tls.key,join(f.directory,'tls/server.key'));
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
