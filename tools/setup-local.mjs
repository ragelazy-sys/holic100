import {writeFile,mkdir,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
async function writeNew(path,content){try{await writeFile(path,content,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
await mkdir('.wrangler',{recursive:true});
await writeNew('.dev.vars',`HOLIC100_PASSWORD=${randomBytes(24).toString('hex')}\nHOLIC100_SESSION_SECRET=${randomBytes(32).toString('hex')}\n`);
await writeNew('wrangler.jsonc',JSON.stringify({name:'holic100',pages_build_output_dir:'./dist',compatibility_date:'2026-10-24',d1_databases:[{binding:'AUTH_DB',database_name:'holic100-auth-local',database_id:'00000000-0000-0000-0000-000000000001',migrations_dir:'migrations'}]},null,2));
let cert=false,key=false;try{await access('.wrangler/local.crt');cert=true;}catch{}try{await access('.wrangler/local.key');key=true;}catch{}
if(cert!==key)throw Error('Incomplete local TLS pair; restore both .wrangler/local.crt and local.key before retrying');
if(!cert)execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','.wrangler/local.key','-out','.wrangler/local.crt','-days','30','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
console.log('Local-only configuration, disposable secrets and TLS pair prepared. Existing files preserved. No deployment performed.');
