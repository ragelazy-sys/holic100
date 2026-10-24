import {pathToFileURL} from 'node:url';
// Read-only preflight. Never print API responses, secret values, or request headers.
export function validateProject(project){
 const errors=[];
 for(const name of ['production','preview']){
  const config=project?.deployment_configs?.[name];
  if(config?.fail_open!==false)errors.push(`${name}: fail_open must be explicitly false`);
  if(!config?.d1_databases?.AUTH_DB?.id)errors.push(`${name}: AUTH_DB binding missing`);
  for(const secret of ['HOLIC100_PASSWORD','HOLIC100_SESSION_SECRET'])if(config?.env_vars?.[secret]?.type!=='secret_text')errors.push(`${name}: ${secret} must be an encrypted Secret`);
 }
 return errors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  for(const name of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','CLOUDFLARE_PAGES_PROJECT'])if(!process.env[name])throw Error(`Missing ${name}`);
  const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(process.env.CLOUDFLARE_PAGES_PROJECT)}`;
  const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.CLOUDFLARE_API_TOKEN}`}});
  if(!response.ok)throw Error(`Cloudflare metadata request failed (${response.status})`);
  const data=await response.json();if(!data.success)throw Error('Cloudflare metadata request unsuccessful');
  const errors=validateProject(data.result);if(errors.length)throw Error(errors.join('\n'));
  console.log('Production and preview metadata: fail-closed, D1 binding and encrypted Secret declarations confirmed. Deployed behavior still requires smoke tests.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
