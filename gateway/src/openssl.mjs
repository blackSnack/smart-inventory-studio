import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);

export async function runOpenSsl(executable, args, cwd) {
  const binary = executable || process.env.GATEWAY_TEST_OPENSSL || process.env.GATEWAY_OPENSSL ||
    (process.platform === 'win32' ? 'openssl.exe' : 'openssl');
  try {
    await exec(binary, args, {cwd, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, encoding: 'utf8'});
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('OpenSSL is unavailable; install a supported OpenSSL 3 runtime or set tls.opensslPath');
    }
    throw new Error('OpenSSL certificate operation failed');
  }
}
