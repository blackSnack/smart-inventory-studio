import {randomUUID, createPrivateKey, X509Certificate} from 'node:crypto';
import {chmod, lstat, mkdir, open, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {join, resolve} from 'node:path';
import {runOpenSsl} from './openssl.mjs';

const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const CA_DAYS = 3650;
const LEAF_DAYS = 397;

function validHost(host) {
  if (typeof host !== 'string' || !host || host.length > 253 || /[\r\n/\\\s]/.test(host)) return false;
  if (isIP(host)) return true;
  return host.split('.').every(label => label.length > 0 && label.length <= 63 &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label));
}

function fingerprint(cert) {
  return cert.fingerprint256.replaceAll(':', '').toUpperCase();
}

function validNow(cert, now) {
  return Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo);
}

function validateCa(certBytes, keyBytes, now) {
  let cert;
  try {
    cert = new X509Certificate(certBytes);
    if (!cert.ca || !cert.checkPrivateKey(createPrivateKey(keyBytes)) || !cert.verify(cert.publicKey) ||
        !validNow(cert, now)) throw new Error('invalid CA');
  } catch {
    throw new Error('Local CA is corrupt, mismatched or expired; refusing silent replacement. Explicit recovery is required.');
  }
  return cert;
}

function validateLeaf(certBytes, keyBytes, ca, host, now) {
  try {
    const leaf = new X509Certificate(certBytes);
    const key = createPrivateKey(keyBytes);
    const sanMatches = isIP(host) ? !!leaf.checkIP(host) : !!leaf.checkHost(host);
    if (leaf.ca || !sanMatches || !leaf.checkPrivateKey(key) || !leaf.verify(ca.publicKey) ||
        !validNow(leaf, now) || (leaf.keyUsage && !leaf.keyUsage.includes(SERVER_AUTH))) return null;
    return leaf;
  } catch {
    return null;
  }
}

async function protectDirectory(directory) {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    const domain = process.env.USERDOMAIN;
    if (!user || !domain) throw new Error('Cannot determine the current Windows account for Gateway data ACLs');
    await runOpenSsl('icacls.exe', [directory, '/inheritance:r', '/grant:r',
      domain + '\\' + user + ':(OI)(CI)F', 'SYSTEM:(OI)(CI)F'], process.cwd());
  } else {
    await chmod(directory, 0o700);
  }
}

async function writePrivate(path, value) {
  await writeFile(path, value, {mode: 0o600, flag: 'wx'});
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function createRoot(directory, executable) {
  const temporary = join(directory, '.root-' + randomUUID());
  await mkdir(temporary, {mode: 0o700});
  try {
    await runOpenSsl(executable, ['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-out','root-ca.key'], temporary);
    await runOpenSsl(executable, ['req','-x509','-new','-key','root-ca.key','-sha256','-days',String(CA_DAYS),
      '-out','root-ca.crt','-subj','/CN=Smart Inventory Local Gateway Root CA',
      '-addext','basicConstraints=critical,CA:TRUE,pathlen:0',
      '-addext','keyUsage=critical,keyCertSign,cRLSign',
      '-addext','subjectKeyIdentifier=hash'], temporary);
    const key = await readFile(join(temporary,'root-ca.key'));
    const cert = await readFile(join(temporary,'root-ca.crt'));
    validateCa(cert,key,Date.now());
    await writePrivate(join(directory,'root-ca.key'),key);
    await writeFile(join(directory,'root-ca.crt'),cert,{flag:'wx'});
  } finally {
    await rm(temporary,{recursive:true,force:true});
  }
}

async function createLeaf(directory, executable, host) {
  const temporary = join(directory, '.leaf-' + randomUUID());
  await mkdir(temporary,{mode:0o700});
  try {
    const san = isIP(host) ? 'IP.1 = ' + host : 'DNS.1 = ' + host;
    const extension = [
      '[server_cert]',
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature,keyEncipherment',
      'extendedKeyUsage=serverAuth',
      'subjectKeyIdentifier=hash',
      'authorityKeyIdentifier=keyid,issuer',
      'subjectAltName=@alt_names',
      '[alt_names]',
      san,
      ''
    ].join('\n');
    await writeFile(join(temporary,'server.ext'),extension,{flag:'wx'});
    await runOpenSsl(executable,['genpkey','-algorithm','EC','-pkeyopt','ec_paramgen_curve:P-256','-out','server.key'],temporary);
    await runOpenSsl(executable,['req','-new','-key','server.key','-out','server.csr','-subj','/CN='+host],temporary);
    await runOpenSsl(executable,['x509','-req','-in','server.csr','-CA',join(directory,'root-ca.crt'),
      '-CAkey',join(directory,'root-ca.key'),'-CAcreateserial','-out','server.crt','-days',String(LEAF_DAYS),
      '-sha256','-extfile','server.ext','-extensions','server_cert'],temporary);
    const cert = await readFile(join(temporary,'server.crt'));
    const key = await readFile(join(temporary,'server.key'));
    const ca = new X509Certificate(await readFile(join(directory,'root-ca.crt')));
    if (!validateLeaf(cert,key,ca,host,Date.now())) throw new Error('Generated TLS server certificate failed validation');
    await writeFile(join(directory,'server.key.next'),key,{mode:0o600,flag:'w'});
    await writeFile(join(directory,'server.crt.next'),cert,{flag:'w'});
    if (process.platform !== 'win32') await chmod(join(directory,'server.key.next'),0o600);
    await rename(join(directory,'server.key.next'),join(directory,'server.key'));
    await rename(join(directory,'server.crt.next'),join(directory,'server.crt'));
  } finally {
    await rm(temporary,{recursive:true,force:true});
    await rm(join(directory,'server.key.next'),{force:true});
    await rm(join(directory,'server.crt.next'),{force:true});
  }
}

async function withCertificateLock(directory, action) {
  const lockPath = join(directory,'.certificate.lock');
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath,'wx',0o600);
      await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
      await handle.close();
    } catch (error) {
      if (handle) { await handle.close().catch(()=>{}); handle=null; }
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now()-started > 30000) {
        throw new Error('Gateway certificate lock is busy or stale; confirm no Gateway process is running before removing .certificate.lock');
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  try { return await action(); }
  finally { await rm(lockPath,{force:true}); }
}

export async function ensureLocalCertificates(config, now) {
  const host = config.host;
  if (!validHost(host)) throw new Error('Invalid TLS certificate host');
  const directory = resolve(config.dataDir,'tls');
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Gateway TLS data path must be a real directory');
  await protectDirectory(directory);
  return withCertificateLock(directory,async()=>{
  const caCertPath = join(directory,'root-ca.crt');
  const caKeyPath = join(directory,'root-ca.key');
  const serverCertPath = join(directory,'server.crt');
  const serverKeyPath = join(directory,'server.key');
  const [hasCaCert,hasCaKey] = await Promise.all([caCertPath,caKeyPath].map(async path => {
    try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  }));
  if (hasCaCert !== hasCaKey) throw new Error('Local CA is incomplete; refusing silent replacement. Explicit recovery is required.');
  if (!hasCaCert) await createRoot(directory,config.tls.opensslPath);

  // Capture wall-clock time after waiting for the lock and after first-time CA creation.
  // Capturing it at function entry can predate the freshly issued certificate's notBefore.
  const validationTime = now ?? Date.now();
  const ca = validateCa(await readFile(caCertPath),await readFile(caKeyPath),validationTime);
  let leaf = null;
  try {
    const [cert,key] = await Promise.all([readFile(serverCertPath),readFile(serverKeyPath)]);
    leaf = validateLeaf(cert,key,ca,host,validationTime);
  } catch {}
  const renewBeforeDays = config.tls.renewBeforeDays ?? 30;
  if (!leaf || Date.parse(leaf.validTo) - validationTime <= renewBeforeDays * 86400000) {
    await createLeaf(directory,config.tls.opensslPath,host);
    leaf = new X509Certificate(await readFile(serverCertPath));
  }
  return {caCertPath,caKeyPath,caFingerprint:fingerprint(ca),certPath:serverCertPath,keyPath:serverKeyPath,
    leafFingerprint:fingerprint(leaf),leafValidTo:leaf.validTo};
  });
}

export async function exportLocalCa({caCertPath,outDir}) {
  const ca = new X509Certificate(await readFile(caCertPath));
  if (!ca.ca) throw new Error('Refusing to export a non-CA certificate');
  const directory = resolve(outDir);
  await mkdir(directory,{recursive:true});
  const certificatePath = join(directory,'smart-inventory-local-ca.crt');
  const profilePath = join(directory,'smart-inventory-local-ca.mobileconfig');
  const uuid = randomUUID().toUpperCase();
  const profile = {
    PayloadContent: [{
      PayloadCertificateFileName: 'SmartInventoryLocalCA.cer',
      PayloadContent: ca.raw.toString('base64'),
      PayloadDescription: 'Local CA certificate. Verify the SHA-256 fingerprint with the Gateway administrator before installation.',
      PayloadDisplayName: 'Smart Inventory Local CA',
      PayloadIdentifier: 'com.smartinventory.gateway.rootca',
      PayloadType: 'com.apple.security.root',
      PayloadUUID: uuid,
      PayloadVersion: 1
    }],
    PayloadDescription: 'Installs the Smart Inventory local root CA. Full trust must be enabled manually in iOS Settings.',
    PayloadDisplayName: 'Smart Inventory Gateway CA',
    PayloadIdentifier: 'com.smartinventory.gateway.ca.profile',
    PayloadOrganization: 'Smart Inventory Studio',
    PayloadRemovalDisallowed: false,
    PayloadType: 'Configuration',
    PayloadUUID: randomUUID().toUpperCase(),
    PayloadVersion: 1
  };
  await writeFile(certificatePath,await readFile(caCertPath),{flag:'w'});
  await writeFile(profilePath,Buffer.from(JSON.stringify(profile,null,2)+'\n'),{flag:'w'});
  return {certificatePath,profilePath,fingerprint:fingerprint(ca)};
}
