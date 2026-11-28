import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {isPrivateOrLoopbackAddress} from './network-address.mjs';

const ownKeys = (value, allowed) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));

export async function loadConfig(file) {
  const absolute = resolve(file);
  let value;
  try { value = JSON.parse(await readFile(absolute, 'utf8')); }
  catch { throw new Error('Invalid or unreadable Gateway configuration'); }
  if (!ownKeys(value, ['host','port','dataDir','tls']) ||
      !isPrivateOrLoopbackAddress(value.host) ||
      !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      (value.dataDir !== undefined && (typeof value.dataDir !== 'string' || !value.dataDir.trim())) ||
      !ownKeys(value.tls, ['mode','cert','key','opensslPath','opensslConfigPath','renewBeforeDays'])) {
    throw new Error('Invalid Gateway configuration');
  }
  const mode = value.tls.mode ?? (value.tls.cert && value.tls.key ? 'provided' : 'local-ca');
  if (!['provided','local-ca'].includes(mode)) throw new Error('Invalid Gateway TLS mode');
  if (mode === 'provided' &&
      !['cert','key'].every(key => typeof value.tls[key] === 'string' && value.tls[key].trim())) {
    throw new Error('Provided TLS mode requires certificate and private key files');
  }
  if (mode === 'local-ca' &&
      (value.tls.cert !== undefined || value.tls.key !== undefined)) {
    throw new Error('Local CA mode does not accept externally supplied certificate paths');
  }
  if (value.tls.opensslPath !== undefined &&
      (typeof value.tls.opensslPath !== 'string' || !value.tls.opensslPath.trim())) {
    throw new Error('Invalid OpenSSL executable path');
  }
  if (value.tls.opensslConfigPath !== undefined &&
      (typeof value.tls.opensslConfigPath !== 'string' || !value.tls.opensslConfigPath.trim())) {
    throw new Error('Invalid OpenSSL configuration path');
  }
  const renewBeforeDays = value.tls.renewBeforeDays ?? 30;
  if (!Number.isInteger(renewBeforeDays) || renewBeforeDays < 1 || renewBeforeDays > 90) {
    throw new Error('TLS renewal window must be between 1 and 90 days');
  }
  const root = dirname(absolute);
  return {
    configPath: absolute,
    host: value.host,
    port: value.port,
    dataDir: resolve(root, value.dataDir ?? './data'),
    tls: mode === 'provided'
      ? {mode, cert: resolve(root, value.tls.cert), key: resolve(root, value.tls.key)}
      : {mode, opensslPath: value.tls.opensslPath ? resolve(root, value.tls.opensslPath) : undefined,
          opensslConfigPath: value.tls.opensslConfigPath ? resolve(root, value.tls.opensslConfigPath) : undefined, renewBeforeDays}
  };
}
