import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

const ownKeys = (value, allowed) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));

export async function loadConfig(file) {
  const absolute = resolve(file);
  let value;
  try { value = JSON.parse(await readFile(absolute, 'utf8')); }
  catch { throw new Error('Invalid or unreadable Gateway configuration'); }
  if (!ownKeys(value, ['host','port','tls']) ||
      !['127.0.0.1','::1'].includes(value.host) ||
      !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      !ownKeys(value.tls, ['cert','key']) ||
      !['cert','key'].every(key => typeof value.tls[key] === 'string' && value.tls[key].trim())) {
    throw new Error('Invalid Gateway configuration: loopback host, port and TLS files required');
  }
  return {host: value.host, port: value.port,
    tls: {cert: resolve(dirname(absolute), value.tls.cert), key: resolve(dirname(absolute), value.tls.key)}};
}
