import {createServer} from 'node:https';
import {X509Certificate, createPrivateKey} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig} from './config.mjs';

export async function createGateway(config) {
  if (!['127.0.0.1','::1'].includes(config.host)) throw new Error('LAN binding not enabled');
  let cert, key;
  try {
    [cert,key] = await Promise.all([readFile(config.tls.cert),readFile(config.tls.key)]);
    const leaf = new X509Certificate(cert);
    const now = Date.now();
    if (leaf.ca || !leaf.checkIP(config.host) || !leaf.checkPrivateKey(createPrivateKey(key)) ||
        !(Date.parse(leaf.validFrom) <= now && now < Date.parse(leaf.validTo))) throw new Error('Invalid TLS leaf');
  } catch { throw new Error('Gateway TLS material missing, invalid, expired or does not match configured host'); }
  return createServer({cert,key,minVersion:'TLSv1.2',requestTimeout:10000,headersTimeout:5000,maxHeaderSize:8192}, (req,res)=>{
    const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if (req.method === 'GET' && req.url === '/api/v1/health') {
      res.writeHead(200,headers); res.end(JSON.stringify({service:'smart-inventory-gateway',apiVersion:1,status:'ok'})); return;
    }
    res.writeHead(404,headers); res.end(JSON.stringify({code:'NOT_FOUND'}));
  });
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--config') throw new Error('Usage: node src/server.mjs --config <file>');
  const config = await loadConfig(process.argv[3]);
  const server = await createGateway(config);
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(config.port,config.host,resolve);
  });
  console.log('Gateway HTTPS listening on configured loopback address');
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.code ? 'Gateway failed to start: '+error.code : error.message); process.exitCode=1;});
}
