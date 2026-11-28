import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {X509Certificate} from 'node:crypto';
import {ensureLocalCertificates,exportLocalCa} from '../src/certificates.mjs';

const openssl=process.env.GATEWAY_TEST_OPENSSL||process.env.GATEWAY_OPENSSL||(process.platform==='win32'?'openssl.exe':'openssl');
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'gateway-ca-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,config:{host:'127.0.0.1',dataDir:join(directory,'data'),tls:{mode:'local-ca',opensslPath:openssl,renewBeforeDays:30}}};
}

test('creates persistent root CA and serverAuth leaf; exports only public CA and iOS profile',async t=>{
  const f=await fixture(t);
  const first=await ensureLocalCertificates(f.config);
  const ca=new X509Certificate(await readFile(first.caCertPath));
  const leaf=new X509Certificate(await readFile(first.certPath));
  assert.equal(ca.ca,true);
  assert.equal(leaf.ca,false);
  assert.ok(leaf.checkIP('127.0.0.1'));
  assert.ok(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
  assert.ok(leaf.verify(ca.publicKey));
  const second=await ensureLocalCertificates(f.config);
  assert.equal(second.caFingerprint,first.caFingerprint);
  assert.equal(second.leafFingerprint,first.leafFingerprint);
  const out=join(f.directory,'export');
  const exported=await exportLocalCa({caCertPath:first.caCertPath,outDir:out});
  assert.equal(exported.fingerprint,first.caFingerprint);
  const profile=JSON.parse(await readFile(exported.profilePath,'utf8'));
  assert.equal(profile.PayloadType,'Configuration');
  assert.equal(profile.PayloadContent[0].PayloadType,'com.apple.security.root');
  assert.equal(profile.PayloadContent[0].PayloadContent,ca.raw.toString('base64'));
  assert.ok(!JSON.stringify(profile).includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(profile).includes('root-ca.key'));
});

test('reissues an expired leaf without replacing the root CA',async t=>{
  const f=await fixture(t);
  const first=await ensureLocalCertificates(f.config);
  const renewed=await ensureLocalCertificates({...f.config,tls:{...f.config.tls,renewBeforeDays:90}});
  assert.equal(renewed.caFingerprint,first.caFingerprint);
  assert.notEqual(renewed.leafFingerprint,first.leafFingerprint);
});

test('refuses incomplete or corrupt root CA instead of silently replacing it',async t=>{
  const f=await fixture(t);
  const first=await ensureLocalCertificates(f.config);
  await rm(first.caKeyPath??join(f.config.dataDir,'tls','root-ca.key'));
  await assert.rejects(ensureLocalCertificates(f.config),/incomplete|corrupt|refusing/i);
  await writeFile(join(f.config.dataDir,'tls','root-ca.key'),'not a private key');
  await assert.rejects(ensureLocalCertificates(f.config),/corrupt|mismatched|refusing/i);
});

test('rejects invalid certificate host names',async t=>{
  const f=await fixture(t);
  await assert.rejects(ensureLocalCertificates({...f.config,host:'127.0.0.1\nsubjectAltName=DNS:evil.example'}),/Invalid TLS certificate host/);
});
