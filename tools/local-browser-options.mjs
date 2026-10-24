import {readFile} from 'node:fs/promises';
import {X509Certificate,createHash} from 'node:crypto';
export async function browserOptions(base){
 const args=['--no-sandbox'];
 if(process.env.LOCAL_TLS_CERT){
  if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local certificate pin is only allowed for loopback tests');
  const cert=new X509Certificate(await readFile(process.env.LOCAL_TLS_CERT));
  const spki=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
  args.push(`--ignore-certificate-errors-spki-list=${spki}`);
 }
 return {executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args};
}
