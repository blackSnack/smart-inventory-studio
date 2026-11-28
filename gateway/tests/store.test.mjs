import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayStore} from '../src/gateway-store.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'gateway-store-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory};
}

test('first-run setup token, password authentication, CSRF and sessions survive restart',async t=>{
  const f=await fixture(t);
  let store=await GatewayStore.open(f.directory);
  assert.equal(store.setupRequired(),true);
  const setupToken=(await readFile(store.setupTokenPath,'utf8')).trim();
  assert.ok(setupToken.length>=40);
  await assert.rejects(store.setup('wrong-token','long-enough-password'),/setup token/);
  await assert.rejects(store.setup(setupToken,'short'),/credentials/);
  const session=await store.setup(setupToken,'a-long-local-admin-password');
  assert.equal(store.setupRequired(),false);
  assert.equal(await readFile(store.setupTokenPath,'utf8').then(()=>true,()=>false),false);
  const authenticated=store.authenticate(session.sessionToken);
  assert.ok(authenticated);
  assert.equal(store.verifyCsrf(authenticated,session.csrfToken),true);
  assert.equal(store.verifyCsrf(authenticated,'wrong-csrf'),false);
  await assert.rejects(store.setup(setupToken,'another-long-password'),/already initialized/);
  store.close();

  store=await GatewayStore.open(f.directory);
  assert.ok(store.authenticate(session.sessionToken));
  const login=store.login('a-long-local-admin-password');
  assert.ok(store.authenticate(login.sessionToken));
  assert.throws(()=>store.login('incorrect-password'),/invalid credentials/);
  store.logout(session.sessionToken);
  assert.equal(store.authenticate(session.sessionToken),null);
  store.close();
});

test('upstream secrets are encrypted at rest and never returned by status',async t=>{
  const f=await fixture(t);
  const store=await GatewayStore.open(f.directory);
  const setupToken=(await readFile(store.setupTokenPath,'utf8')).trim();
  await store.setup(setupToken,'a-long-local-admin-password');
  const inventorySecret='inventree-token-never-store-plaintext';
  const aiSecret='ai-key-never-store-plaintext';
  store.setConnection('inventree','https://inventory.example/api',inventorySecret);
  store.setConnection('ai','https://agent.example/v1',aiSecret,'vision-model');
  const status=store.connectionStatus();
  assert.equal(status.inventree.configured,true);
  assert.equal(status.inventree.tokenConfigured,true);
  assert.equal(status.inventree.token,undefined);
  assert.equal(status.ai.model,'vision-model');
  assert.equal(status.ai.apiKeyConfigured,true);
  assert.equal(status.ai.apiKey,undefined);
  assert.deepEqual(store.connection('inventree'),{baseUrl:'https://inventory.example/api/',token:inventorySecret});
  assert.deepEqual(store.connection('ai'),{baseUrl:'https://agent.example/v1/',model:'vision-model',apiKey:aiSecret});
  const database=await readFile(join(f.directory,'gateway.sqlite'));
  assert.equal(database.includes(Buffer.from(inventorySecret)),false);
  assert.equal(database.includes(Buffer.from(aiSecret)),false);
  store.deleteConnection('ai');
  assert.equal(store.connection('ai'),null);
  store.close();
});

test('missing first-run setup token fails closed instead of silently issuing a replacement',async t=>{
  const f=await fixture(t);
  const store=await GatewayStore.open(f.directory);
  await rm(store.setupTokenPath,{force:true});
  store.close();
  await assert.rejects(GatewayStore.open(f.directory),/setup token file is missing/);
});

test('login attempts are throttled by a hashed client identity',async t=>{
  const f=await fixture(t),store=await GatewayStore.open(f.directory);
  const setupToken=(await readFile(store.setupTokenPath,'utf8')).trim();
  await store.setup(setupToken,'a-long-local-admin-password');
  for(let i=0;i<4;i++)assert.throws(()=>store.login('wrong-password','test-client'),/invalid credentials/);
  assert.throws(()=>store.login('wrong-password','test-client'),/login rate limited/);
  assert.throws(()=>store.login('a-long-local-admin-password','test-client'),/login rate limited/);
  assert.ok(store.login('a-long-local-admin-password','different-client'));
  store.close();
});

test('missing encryption key for an existing database fails closed',async t=>{
  const f=await fixture(t),store=await GatewayStore.open(f.directory);
  const setupToken=(await readFile(store.setupTokenPath,'utf8')).trim();
  await store.setup(setupToken,'a-long-local-admin-password');
  store.setConnection('inventree','https://inventory.example/api','saved-inventory-secret');
  store.close();
  const keyPath=join(f.directory,'secret.key');
  await rm(keyPath);
  await assert.rejects(GatewayStore.open(f.directory),/missing while an existing database is present/);
  assert.equal(await readFile(keyPath).then(()=>true,()=>false),false);
});

test('corrupt encryption key fails closed without replacing it',async t=>{
  const f=await fixture(t);
  const store=await GatewayStore.open(f.directory);
  store.close();
  const keyPath=join(f.directory,'secret.key');
  const original=await readFile(keyPath);
  await (await import('node:fs/promises')).writeFile(keyPath,'bad');
  await assert.rejects(GatewayStore.open(f.directory),/encryption key is corrupt/);
  assert.equal((await readFile(keyPath)).toString(),'bad');
  assert.equal(original.length,32);
});
