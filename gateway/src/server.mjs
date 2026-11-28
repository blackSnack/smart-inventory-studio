import {createServer} from 'node:https';
import {X509Certificate, createPrivateKey, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {loadConfig} from './config.mjs';
import {ensureLocalCertificates} from './certificates.mjs';
import {GatewayStore} from './gateway-store.mjs';

const SESSION_COOKIE='gateway_session';
const BODY_LIMIT=64*1024;

class HttpError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code}
}

function send(res,status,body,extra={}) {
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    ...extra
  });
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  try {
    if(typeof req.headers.origin!=='string'||typeof req.headers.host!=='string')return false;
    return new URL(req.headers.origin).origin===new URL('https://'+req.headers.host).origin;
  } catch {return false}
}

function sessionCookie(req) {
  const raw=req.headers.cookie;
  if(typeof raw!=='string')return '';
  for(const item of raw.split(';')){
    const [name,...parts]=item.trim().split('=');
    if(name===SESSION_COOKIE)return parts.join('=');
  }
  return '';
}

function setSessionCookie(res,value) {
  res.setHeader('Set-Cookie',SESSION_COOKIE+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800');
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',SESSION_COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
}

async function readJson(req) {
  const type=String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if(type!=='application/json')throw new HttpError(415,'UNSUPPORTED_MEDIA_TYPE','JSON request body required');
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(String(declared))||Number(declared)>BODY_LIMIT))throw new HttpError(413,'BODY_TOO_LARGE','Request body too large');
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>BODY_LIMIT)throw new HttpError(413,'BODY_TOO_LARGE','Request body too large');
    chunks.push(chunk);
  }
  let value;
  try {value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch {throw new HttpError(400,'INVALID_JSON','Invalid JSON request body')}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new HttpError(400,'INVALID_JSON','JSON object required');
  return value;
}

function exactKeys(value,keys) {
  return Object.keys(value).every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(value,key));
}

function requireOrigin(req) {
  if(!sameOrigin(req))throw new HttpError(403,'ORIGIN_REJECTED','Same-origin request required');
}

function requireSession(req,store,csrf=false) {
  const value=sessionCookie(req),session=store.authenticate(value);
  if(!session)throw new HttpError(401,'AUTH_REQUIRED','Administrator authentication required');
  if(csrf){
    requireOrigin(req);
    if(!store.verifyCsrf(session,req.headers['x-csrf-token']))throw new HttpError(403,'CSRF_REJECTED','Invalid CSRF token');
  }
  return {value,session};
}

function mapError(error) {
  if(error instanceof HttpError)return error;
  const message=error instanceof Error?error.message:'';
  if(message==='invalid setup token')return new HttpError(401,'INVALID_SETUP_TOKEN','Invalid setup token');
  if(message==='invalid credentials')return new HttpError(401,'INVALID_CREDENTIALS','Invalid credentials');
  if(message==='login rate limited')return new HttpError(429,'LOGIN_RATE_LIMITED','Too many login attempts; try again later');
  if(message==='Gateway administrator is already initialized')return new HttpError(409,'ALREADY_INITIALIZED','Gateway administrator is already initialized');
  if(message==='Gateway administrator is not initialized')return new HttpError(409,'NOT_INITIALIZED','Gateway administrator is not initialized');
  if(message==='invalid initial credentials'||message==='AI model is required'||message==='invalid upstream configuration'||
      message==='invalid upstream URL'||message.startsWith('upstream must use HTTPS'))return new HttpError(400,'INVALID_CONFIGURATION','Invalid Gateway configuration');
  return new HttpError(500,'INTERNAL_ERROR','Gateway request failed');
}

async function handleRequest(req,res,store) {
  const requestId=randomUUID();
  try {
    const host=req.headers.host;
    if(typeof host!=='string'||host.length>255)throw new HttpError(400,'INVALID_HOST','Invalid request host');
    const url=new URL(req.url??'/', 'https://'+host);
    if(url.search||url.hash)throw new HttpError(404,'NOT_FOUND','Not found');
    const path=url.pathname;

    if(req.method==='GET'&&path==='/api/v1/health'){
      send(res,200,{service:'smart-inventory-gateway',apiVersion:1,status:'ok'});return;
    }
    if(req.method==='GET'&&path==='/api/v1/setup/status'){
      send(res,200,{required:store.setupRequired()});return;
    }
    if(req.method==='POST'&&path==='/api/v1/setup'){
      requireOrigin(req);
      const body=await readJson(req);
      if(!exactKeys(body,['setupToken','password']))throw new HttpError(400,'INVALID_CONFIGURATION','Invalid initial credentials');
      const session=await store.setup(body.setupToken,body.password);
      setSessionCookie(res,session.sessionToken);
      send(res,201,{authenticated:true,csrfToken:session.csrfToken,expiresAt:session.expiresAt});return;
    }
    if(req.method==='POST'&&path==='/api/v1/auth/login'){
      requireOrigin(req);
      const body=await readJson(req);
      if(!exactKeys(body,['password']))throw new HttpError(400,'INVALID_CONFIGURATION','Invalid credentials');
      const session=store.login(body.password,req.socket.remoteAddress??'local');
      setSessionCookie(res,session.sessionToken);
      send(res,200,{authenticated:true,csrfToken:session.csrfToken,expiresAt:session.expiresAt});return;
    }
    if(req.method==='GET'&&path==='/api/v1/auth/session'){
      const current=sessionCookie(req),refreshed=store.refreshCsrf(current);
      if(!refreshed){send(res,200,{authenticated:false});return}
      send(res,200,{authenticated:true,csrfToken:refreshed.csrfToken,expiresAt:refreshed.expiresAt});return;
    }
    if(req.method==='POST'&&path==='/api/v1/auth/logout'){
      const auth=requireSession(req,store,true);
      store.logout(auth.value);clearSessionCookie(res);
      send(res,200,{authenticated:false});return;
    }
    if(req.method==='GET'&&path==='/api/v1/admin/connections'){
      requireSession(req,store);
      send(res,200,store.connectionStatus());return;
    }
    if(req.method==='PUT'&&path==='/api/v1/admin/connections/inventree'){
      requireSession(req,store,true);
      const body=await readJson(req);
      if(!exactKeys(body,['baseUrl','token']))throw new HttpError(400,'INVALID_CONFIGURATION','Invalid Inventory connection');
      store.setConnection('inventree',body.baseUrl,body.token);
      send(res,200,{saved:true,connection:store.connectionStatus().inventree});return;
    }
    if(req.method==='PUT'&&path==='/api/v1/admin/connections/ai'){
      requireSession(req,store,true);
      const body=await readJson(req);
      if(!exactKeys(body,['baseUrl','apiKey','model']))throw new HttpError(400,'INVALID_CONFIGURATION','Invalid AI connection');
      store.setConnection('ai',body.baseUrl,body.apiKey,body.model);
      send(res,200,{saved:true,connection:store.connectionStatus().ai});return;
    }
    const remove=path.match(/^\/api\/v1\/admin\/connections\/(inventree|ai)$/);
    if(req.method==='DELETE'&&remove){
      requireSession(req,store,true);
      store.deleteConnection(remove[1]);
      send(res,200,{saved:true,connection:store.connectionStatus()[remove[1]]});return;
    }
    throw new HttpError(404,'NOT_FOUND','Not found');
  } catch(error) {
    const mapped=mapError(error);
    if(mapped.status>=500)console.error('Gateway request failed ['+requestId+']');
    send(res,mapped.status,{code:mapped.code,message:mapped.message,requestId});
  }
}

export async function createGateway(config) {
  if (!['127.0.0.1','::1'].includes(config.host)) throw new Error('LAN binding not enabled');
  const material = config.tls.mode === 'local-ca'
    ? await ensureLocalCertificates(config)
    : {certPath:config.tls.cert,keyPath:config.tls.key};
  let cert, key;
  try {
    [cert,key] = await Promise.all([readFile(material.certPath),readFile(material.keyPath)]);
  } catch {
    throw new Error('Gateway TLS certificate or private key is missing or unreadable');
  }
  let leaf;
  try {
    leaf = new X509Certificate(cert);
    if (!leaf.checkPrivateKey(createPrivateKey(key))) throw new Error('Certificate/private key mismatch');
  } catch {
    throw new Error('Gateway TLS certificate or private key is invalid or mismatched');
  }
  const now = Date.now();
  if (leaf.ca || !leaf.checkIP(config.host) ||
      !(Date.parse(leaf.validFrom) <= now && now < Date.parse(leaf.validTo))) {
    throw new Error('Gateway TLS certificate is a CA, has the wrong IP SAN or is outside its validity period');
  }
  const serverAuth = '1.3.6.1.5.5.7.3.1';
  if (leaf.keyUsage && !leaf.keyUsage.includes(serverAuth)) {
    throw new Error('Gateway TLS certificate does not explicitly permit TLS server authentication');
  }
  const store=await GatewayStore.open(config.dataDir);
  const server=createServer({cert,key,minVersion:'TLSv1.2',requestTimeout:15000,headersTimeout:5000,maxHeaderSize:8192}, (req,res)=>{
    void handleRequest(req,res,store).catch(()=>{
      if(!res.headersSent)send(res,500,{code:'INTERNAL_ERROR',message:'Gateway request failed',requestId:randomUUID()});
      else res.destroy();
    });
  });
  server.gatewayStore=store;
  server.gatewaySetupTokenPath=store.setupTokenPath;
  server.once('close',()=>store.close());
  return server;
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
  if(server.gatewayStore.setupRequired())console.log('Complete first-run administrator setup using the protected token file: '+server.gatewaySetupTokenPath);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>server.close());
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.code ? 'Gateway failed to start: '+error.code : error.message); process.exitCode=1;});
}
