import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadConfig} from './config.mjs';
import {ensureLocalCertificates,exportLocalCa} from './certificates.mjs';

function value(args,name) {
  const index=args.indexOf(name);
  return index>=0?args[index+1]:undefined;
}

async function main() {
  const [group,action,...args]=process.argv.slice(2);
  if (group!=='ca'||action!=='export') throw new Error('Usage: node src/cli.mjs ca export --config <file> --out <directory>');
  const configPath=value(args,'--config');
  const out=value(args,'--out');
  if (!configPath||!out) throw new Error('Both --config and --out are required');
  const config=await loadConfig(configPath);
  if (config.tls.mode!=='local-ca') throw new Error('CA export requires tls.mode=local-ca');
  const material=await ensureLocalCertificates(config);
  await mkdir(resolve(out),{recursive:true});
  const exported=await exportLocalCa({caCertPath:material.caCertPath,outDir:out});
  console.log('CA SHA-256: '+exported.fingerprint);
  console.log('Public certificate: '+exported.certificatePath);
  console.log('iOS configuration profile: '+exported.profilePath);
  console.log('Verify the fingerprint through a trusted channel before installing. Enable full trust manually in iOS Settings.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
