import {openSync,writeFileSync,fsyncSync,closeSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
// One write-once claim and one write-once acknowledgement per exact preparation hash.
// Keep the same private journal directory; loss of this evidence is a manual recovery block.
export class LocalNativeReceiptEvidence{
 constructor(directory){this.directory=directory}
 path(binding,suffix){if(!/^[a-f0-9]{64}$/.test(binding))throw Error('invalid binding');return join(this.directory,binding+suffix)}
 write(path,data){const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(data)+'\n');fsyncSync(fd)}finally{closeSync(fd)}}
 load(path){try{if(statSync(path).size>4096)throw Error('invalid evidence size');return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e.code==='ENOENT')return undefined;throw e}}
 async claim(binding){try{this.write(this.path(binding,'.claim.json'),{binding});return true}catch(e){if(e.code==='EEXIST')return false;throw e}}
 async acknowledge(binding,stockId){if(this.load(this.path(binding,'.claim.json'))?.binding!==binding||!/^[1-9][0-9]{0,15}$/.test(stockId))throw Error('invalid acknowledgement');this.write(this.path(binding,'.ack.json'),{binding,stockId})}
 async read(binding){const claim=this.load(this.path(binding,'.claim.json'));if(!claim)return;if(claim.binding!==binding)throw Error('invalid claim');const ack=this.load(this.path(binding,'.ack.json'));if(!ack)return {};if(ack.binding!==binding||!/^[1-9][0-9]{0,15}$/.test(ack.stockId))throw Error('invalid ack');return {stockId:ack.stockId}}
}
