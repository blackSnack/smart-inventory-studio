import {randomBytes,createHash,createCipheriv,createDecipheriv,scryptSync,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {chmod,lstat,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {securePrivateDirectory,writePrivateFile} from './private-storage.mjs';
import {SQLiteJournalStore} from './sqlite-journal.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const passwordMin=12;
const sessionLifetime=8*60*60*1000;

function same(a,b) {
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}

function normalizeHttpsBase(value) {
  if(typeof value!=='string'||!value.trim()||value.length>2048)throw Error('invalid upstream URL');
  let url;
  try {url=new URL(value)} catch {throw Error('invalid upstream URL')}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('upstream must use HTTPS without embedded credentials, query or fragment');
  url.pathname=url.pathname.replace(/\/+$/,'')+'/';
  return url.href;
}

function encrypt(key,value) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),data:data.toString('base64url')});
}

function decrypt(key,value) {
  let record;
  try {record=JSON.parse(value)} catch {throw Error('encrypted connection data is corrupt')}
  if(record?.v!==1||typeof record.iv!=='string'||typeof record.tag!=='string'||typeof record.data!=='string')throw Error('encrypted connection data is corrupt');
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64url'));
    decipher.setAuthTag(Buffer.from(record.tag,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(record.data,'base64url')),decipher.final()]).toString('utf8');
  } catch {throw Error('encrypted connection data cannot be decrypted')}
}

export class GatewayStore {
  static async open(dataDirectory) {
    const directory=resolve(dataDirectory);
    await securePrivateDirectory(directory);
    const keyPath=join(directory,'secret.key');
    const databasePath=join(directory,'gateway.sqlite');
    let key;
    try {key=await readFile(keyPath)} catch(error) {
      if(error?.code!=='ENOENT')throw new Error('Gateway encryption key is unavailable');
      let databaseExists=false;
      try {await lstat(databasePath);databaseExists=true} catch(statError) {if(statError?.code!=='ENOENT')throw new Error('Existing Gateway database cannot be inspected')}
      if(databaseExists)throw new Error('Gateway encryption key is missing while an existing database is present; restore the matching secret.key backup. Refusing to generate a replacement.');
      const created=randomBytes(32);
      try {await writePrivateFile(keyPath,created)} catch(writeError) {
        if(writeError?.code!=='EEXIST')throw writeError;
      }
      key=await readFile(keyPath);
    }
    if(key.length!==32)throw new Error('Gateway encryption key is corrupt; refusing silent replacement');

    const db=new DatabaseSync(databasePath);
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const schemaVersion=db.prepare('PRAGMA user_version').get().user_version;
      if(schemaVersion>1)throw new Error('Gateway database schema is newer than this Gateway build');
      db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS gateway_admin(id INTEGER PRIMARY KEY CHECK(id=1),salt BLOB NOT NULL,password_hash BLOB NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS gateway_sessions(token_hash TEXT PRIMARY KEY,csrf_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS gateway_sessions_expiry ON gateway_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS gateway_login_attempts(client_hash TEXT PRIMARY KEY,window_started_at INTEGER NOT NULL,failures INTEGER NOT NULL,blocked_until INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS gateway_connections(provider TEXT PRIMARY KEY,base_url TEXT NOT NULL,model TEXT NOT NULL,secret_ciphertext TEXT NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS gateway_journals(instance_id TEXT NOT NULL,plan_id TEXT NOT NULL,revision INTEGER NOT NULL,journal_json TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(instance_id,plan_id));
        CREATE TABLE IF NOT EXISTS gateway_journal_operation_ids(instance_id TEXT NOT NULL,operation_id TEXT NOT NULL,plan_id TEXT NOT NULL,PRIMARY KEY(instance_id,operation_id),FOREIGN KEY(instance_id,plan_id) REFERENCES gateway_journals(instance_id,plan_id) ON DELETE CASCADE);
      `);
      if(schemaVersion===0)db.exec('PRAGMA user_version=1');
      if(process.platform!=='win32')await chmod(databasePath,0o600);
      const store=new GatewayStore(directory,db,key);
      await store.ensureSetupToken();
      return store;
    } catch(error) {
      db.close();
      throw error;
    }
  }

  constructor(directory,db,key) {
    this.directory=directory;this.db=db;this.key=key;
    this.setupTokenPath=join(directory,'setup-token.txt');
  }

  async ensureSetupToken() {
    this.db.exec('BEGIN IMMEDIATE');
    let created=false;
    try {
      if(this.db.prepare('SELECT id FROM gateway_admin WHERE id=1').get()) {
        await rm(this.setupTokenPath,{force:true});
        this.db.exec('COMMIT');
        return;
      }
      const existing=this.db.prepare('SELECT value FROM gateway_metadata WHERE key=?').get('setup_token_hash');
      if(existing) {
        let stored;
        try {stored=(await readFile(this.setupTokenPath,'utf8')).trim()} catch {
          throw new Error('Gateway setup token file is missing; refusing to issue a replacement automatically');
        }
        if(!stored||!same(hash(stored),existing.value))throw new Error('Gateway setup token file does not match its database record');
        this.db.exec('COMMIT');
        return;
      }
      // A token file without a matching database hash is an orphan from an interrupted first boot.
      await rm(this.setupTokenPath,{force:true});
      const setupToken=token();
      await writePrivateFile(this.setupTokenPath,setupToken+'\n');
      created=true;
      this.db.prepare('INSERT INTO gateway_metadata(key,value) VALUES(?,?)').run('setup_token_hash',hash(setupToken));
      this.db.exec('COMMIT');
    } catch(error) {
      try {this.db.exec('ROLLBACK')}catch{}
      if(created)await rm(this.setupTokenPath,{force:true});
      throw error;
    }
  }

  setupRequired() {return !this.db.prepare('SELECT id FROM gateway_admin WHERE id=1').get()}

  async setup(setupToken,password) {
    if(!this.setupRequired())throw Error('Gateway administrator is already initialized');
    if(typeof setupToken!=='string'||typeof password!=='string'||password.length<passwordMin||password.length>256)throw Error('invalid initial credentials');
    const row=this.db.prepare('SELECT value FROM gateway_metadata WHERE key=?').get('setup_token_hash');
    if(!row||!same(hash(setupToken),row.value))throw Error('invalid setup token');
    const salt=randomBytes(16),passwordHash=scryptSync(password,salt,64);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(!this.setupRequired())throw Error('Gateway administrator is already initialized');
      this.db.prepare('INSERT INTO gateway_admin(id,salt,password_hash,created_at) VALUES(1,?,?,?)').run(salt,passwordHash,Date.now());
      this.db.prepare('DELETE FROM gateway_metadata WHERE key=?').run('setup_token_hash');
      this.db.exec('COMMIT');
    } catch(error) {try{this.db.exec('ROLLBACK')}catch{}throw error}
    await rm(this.setupTokenPath,{force:true});
    return this.createSession();
  }

  login(password,clientIdentity='local') {
    if(typeof password!=='string'||password.length>256)throw Error('invalid credentials');
    const clientHash=hash(typeof clientIdentity==='string'?clientIdentity:'local');
    const now=Date.now();
    this.db.prepare('DELETE FROM gateway_login_attempts WHERE window_started_at<? AND blocked_until<?').run(now-24*60*60*1000,now);
    const attempt=this.db.prepare('SELECT window_started_at,failures,blocked_until FROM gateway_login_attempts WHERE client_hash=?').get(clientHash);
    if(attempt&&attempt.blocked_until>now)throw Error('login rate limited');
    const row=this.db.prepare('SELECT salt,password_hash FROM gateway_admin WHERE id=1').get();
    if(!row)throw Error('Gateway administrator is not initialized');
    const candidate=scryptSync(password,row.salt,64);
    if(!same(candidate,row.password_hash)){
      const windowStart=attempt&&now-attempt.window_started_at<15*60*1000?attempt.window_started_at:now;
      const failures=windowStart===attempt?.window_started_at?attempt.failures+1:1;
      const blockedUntil=failures>=5?now+15*60*1000:0;
      this.db.prepare(`INSERT INTO gateway_login_attempts(client_hash,window_started_at,failures,blocked_until) VALUES(?,?,?,?)
        ON CONFLICT(client_hash) DO UPDATE SET window_started_at=excluded.window_started_at,failures=excluded.failures,blocked_until=excluded.blocked_until`)
        .run(clientHash,windowStart,failures,blockedUntil);
      if(blockedUntil)throw Error('login rate limited');
      throw Error('invalid credentials');
    }
    this.db.prepare('DELETE FROM gateway_login_attempts WHERE client_hash=?').run(clientHash);
    return this.createSession();
  }

  createSession() {
    const sessionToken=token(),csrfToken=token(),expiresAt=Date.now()+sessionLifetime;
    this.db.prepare('DELETE FROM gateway_sessions WHERE expires_at<=?').run(Date.now());
    this.db.prepare('INSERT INTO gateway_sessions(token_hash,csrf_hash,expires_at) VALUES(?,?,?)')
      .run(hash(sessionToken),hash(csrfToken),expiresAt);
    return {sessionToken,csrfToken,expiresAt};
  }

  authenticate(sessionToken) {
    if(typeof sessionToken!=='string'||!sessionToken)return null;
    const row=this.db.prepare('SELECT csrf_hash,expires_at FROM gateway_sessions WHERE token_hash=?').get(hash(sessionToken));
    if(!row)return null;
    if(row.expires_at<=Date.now()){this.db.prepare('DELETE FROM gateway_sessions WHERE token_hash=?').run(hash(sessionToken));return null}
    return {csrfHash:row.csrf_hash,expiresAt:row.expires_at};
  }

  refreshCsrf(sessionToken) {
    const session=this.authenticate(sessionToken);
    if(!session)return null;
    const csrfToken=token();
    this.db.prepare('UPDATE gateway_sessions SET csrf_hash=? WHERE token_hash=?').run(hash(csrfToken),hash(sessionToken));
    return {csrfToken,expiresAt:session.expiresAt};
  }

  verifyCsrf(session,csrfToken) {
    return !!session&&typeof csrfToken==='string'&&same(hash(csrfToken),session.csrfHash);
  }

  logout(sessionToken) {
    if(typeof sessionToken==='string'&&sessionToken)this.db.prepare('DELETE FROM gateway_sessions WHERE token_hash=?').run(hash(sessionToken));
  }

  setConnection(provider,baseUrl,secret,model='') {
    if(!['inventree','ai'].includes(provider)||typeof secret!=='string'||!secret.trim()||secret.length>8192||
        typeof model!=='string'||model.length>256)throw Error('invalid upstream configuration');
    const base=normalizeHttpsBase(baseUrl);
    if(provider==='ai'&&!model.trim())throw Error('AI model is required');
    this.db.prepare(`INSERT INTO gateway_connections(provider,base_url,model,secret_ciphertext,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET base_url=excluded.base_url,model=excluded.model,
      secret_ciphertext=excluded.secret_ciphertext,updated_at=excluded.updated_at`)
      .run(provider,base,model,encrypt(this.key,secret),Date.now());
  }

  deleteConnection(provider) {
    if(!['inventree','ai'].includes(provider))throw Error('invalid provider');
    this.db.prepare('DELETE FROM gateway_connections WHERE provider=?').run(provider);
  }

  connectionStatus() {
    const rows=this.db.prepare('SELECT provider,base_url,model,updated_at FROM gateway_connections').all();
    const status={inventree:{configured:false,baseUrl:'',tokenConfigured:false},ai:{configured:false,baseUrl:'',model:'',apiKeyConfigured:false}};
    for(const row of rows){
      if(row.provider==='inventree')status.inventree={configured:true,baseUrl:row.base_url,tokenConfigured:true,updatedAt:row.updated_at};
      if(row.provider==='ai')status.ai={configured:true,baseUrl:row.base_url,model:row.model,apiKeyConfigured:true,updatedAt:row.updated_at};
    }
    return status;
  }

  connection(provider) {
    const row=this.db.prepare('SELECT base_url,model,secret_ciphertext FROM gateway_connections WHERE provider=?').get(provider);
    if(!row)return null;
    const secret=decrypt(this.key,row.secret_ciphertext);
    return provider==='inventree'?{baseUrl:row.base_url,token:secret}:{baseUrl:row.base_url,model:row.model,apiKey:secret};
  }

  journalStore(instanceId) {return new SQLiteJournalStore(this.db,instanceId)}
  close() {this.db.close()}
}
