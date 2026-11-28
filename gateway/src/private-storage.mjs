import {chmod,lstat,mkdir,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);

export async function securePrivateDirectory(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Gateway private data path must be a real directory');
  if(process.platform==='win32'){
    const user=process.env.USERNAME,domain=process.env.USERDOMAIN;
    if(!user||!domain)throw new Error('Cannot determine the current Windows account for Gateway data ACLs');
    try {
      await exec('icacls.exe',[directory,'/inheritance:r','/grant:r',
        domain+'\\'+user+':(OI)(CI)F','SYSTEM:(OI)(CI)F'],{windowsHide:true,timeout:15000});
    } catch {
      throw new Error('Unable to restrict Gateway data directory ACLs');
    }
  } else {
    await chmod(directory,0o700);
  }
}

export async function writePrivateFile(path,value,{exclusive=true}={}) {
  await writeFile(path,value,{mode:0o600,flag:exclusive?'wx':'w'});
  if(process.platform!=='win32')await chmod(path,0o600);
}
