import {openSync,writeFileSync,fsyncSync,closeSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
// Operation ID is reserved independently of preparation hash. Re-preparing the same ID cannot replay a write.
export class LocalNativeOperationEvidence{
 constructor(directory){this.directory=directory}
 path(key,suffix){if(!/^[a-f0-9]{64}$/.test(key))throw Error('invalid operation key');return join(this.directory,key+suffix)}
 write(path,data){const encoded=JSON.stringify(data)+'\n';if(Buffer.byteLength(encoded)>16*1024*1024)throw Error('private evidence limit');const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,encoded);fsyncSync(fd)}finally{closeSync(fd)}}
 load(path){try{if(statSync(path).size>16*1024*1024)throw Error('private evidence limit');return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e.code==='ENOENT')return undefined;throw e}}
 valid(binding){if(!/^[a-f0-9]{64}$/.test(binding))throw Error('invalid preparation binding')}
 async claim(key,binding){this.valid(binding);try{this.write(this.path(key,'.operation-claim.json'),{key,binding});return true}catch(e){if(e.code==='EEXIST')return false;throw e}}
 async record(key,binding,ack){this.valid(binding);const c=this.load(this.path(key,'.operation-claim.json'));if(c?.key!==key||c.binding!==binding||ack===undefined)throw Error('invalid operation acknowledgement');this.write(this.path(key,'.operation-ack.json'),{key,binding,ack})}
 async read(key,binding){this.valid(binding);const c=this.load(this.path(key,'.operation-claim.json'));if(!c)return;if(c.key!==key||c.binding!==binding)throw Error('operation reservation mismatch');const a=this.load(this.path(key,'.operation-ack.json'));if(!a)return;if(a.key!==key||a.binding!==binding||!Object.hasOwn(a,'ack'))throw Error('operation acknowledgement mismatch');return {ack:a.ack}}
}
