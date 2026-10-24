import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject} from '../tools/check-cloudflare-settings.mjs';
test('release preflight rejects missing/unknown and fail-open production or preview configuration',()=>{
 assert.equal(validateProject({}).length,8);
 for(const name of ['production','preview']){
  const configs=Object.fromEntries(['production','preview'].map(env=>[env,{fail_open:false,d1_databases:{AUTH_DB:{id:'local-test-id'}},env_vars:{HOLIC100_PASSWORD:{type:'secret_text'},HOLIC100_SESSION_SECRET:{type:'secret_text'}}}]));
  assert.deepEqual(validateProject({deployment_configs:configs}),[]);configs[name].fail_open=true;assert.equal(validateProject({deployment_configs:configs}).length,1);
  configs[name].fail_open=false;configs[name].env_vars.HOLIC100_PASSWORD.type='plain_text';assert.equal(validateProject({deployment_configs:configs}).length,1);
 }
});
