/** Read-only verification of the bucket/prefix configured for BetGenius. No keys or object contents leave the server. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const emit=(kind,data)=>console.log(JSON.stringify({kind,...data}));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const base='cd /opt/betgenius && docker compose --env-file deploy.env';
function ssh(command){return execFileSync('ssh',['-o','BatchMode=yes','vps',command],{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});}
const envScript=script=>'if [ -r /ops/env.sh ]; then . /ops/env.sh; fi; '+script;
const betExec=script=>base+' exec -T ops sh -c '+quote(envScript(script));
const safePath=s=>/^[a-z0-9][a-z0-9._/-]{0,180}$/i.test(s)&&!s.split('/').some(x=>x==='..');
function failure(e){const s=String(e.stderr??'');return /AccessDenied|403|Unauthorized|InvalidAccessKey|SignatureDoesNotMatch/i.test(s)?'storage-access-denied':/no such host/i.test(s)?'storage-dns-error':/NoSuchBucket|bucket.*not.*exist|directory not found|404/i.test(s)?'bucket-or-prefix-not-found':'read-only-probe-failed';}
async function main(){
 assert.equal(process.env.OPERATIONAL_READ_ONLY_AUDIT,'yes');
 const configured=ssh(betExec('printf %s "${BACKUP_BUCKET-}"')).trim();assert.ok(safePath(configured),'invalid/non-path backup destination');
 const disk=ssh("cd /opt/betgenius && sed -n 's/^BACKUP_BUCKET=//p' ops.env").trim().replace(/^(["'])(.*)\1$/,'$2');
 const container=ssh(base+' exec -T ops sh -c '+quote('printf %s "${BACKUP_BUCKET-}"')).trim();
 const [bucket,...parts]=configured.split('/');
 emit('betgenius_backup_destination',{configured,bucket,prefix:parts.join('/'),disk_matches_runtime:disk===configured,container_matches_cron:container===configured,user_reported_bucket:'scholkit',uses_scholkit:bucket==='scholkit'});
 const containers=ssh('docker ps --filter label=com.docker.compose.service=ops --format '+quote('{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}')).trim().split('\n').filter(Boolean).map(s=>{const[id,name,project]=s.split(/\s+/);return{id,name,project};});
 const school=containers.filter(x=>/school|scholkit|naija/i.test(x.name+' '+x.project));
 emit('schoolkit_ops_candidates',{containers:school.map(({name,project})=>({name,project}))});
 if(school.length!==1){emit('bucket_verification_blocked',{reason:'no unique School Kit ops container available for existing authenticated read-only access'});process.exitCode=1;return;}
 const id=school[0].id;assert.match(id,/^[a-f0-9]{12,64}$/);
 const schoolExec=script=>'docker exec '+id+' sh -c '+quote(envScript(script));
 const schoolDestination=ssh(schoolExec('printf %s "${BACKUP_BUCKET-}"')).trim();
 emit('schoolkit_backup_destination',{configured:safePath(schoolDestination)?schoolDestination:'(unset or unexpected format)'});
 const remotes=ssh(schoolExec('rclone listremotes')).trim().split('\n').map(s=>s.trim());
 const remote=['backup:','r2:'].find(s=>remotes.includes(s));
 if(!remote){emit('bucket_verification_blocked',{reason:'expected backup/r2 remote unavailable in School Kit ops'});process.exitCode=1;return;}
 const alias=remote.slice(0,-1);assert.match(alias,/^(backup|r2)$/);
 const key='RCLONE_CONFIG_'+alias.toUpperCase()+'_';
 const metadata=ssh(schoolExec('printf "%s\\0" "${'+key+'TYPE-}" "${'+key+'PROVIDER-}" "${'+key+'ENDPOINT-}"')).split('\0');
 const [storageType,storageProvider,storageEndpoint]=metadata;
 let endpointHost=null;try{endpointHost=new URL(storageEndpoint.includes('://')?storageEndpoint:'https://'+storageEndpoint).hostname;}catch{}
 const cloudflare=!!endpointHost&&/(^|\.)r2\.cloudflarestorage\.com$/i.test(endpointHost);
 emit('schoolkit_storage_backend',{remote,type:/^[a-z0-9_-]{1,30}$/i.test(storageType||'')?storageType:'(not in environment)',provider:/^[a-z0-9_-]{1,40}$/i.test(storageProvider||'')?storageProvider:'(not in environment)',endpoint_hostname:endpointHost,cloudflare_r2_endpoint:cloudflare});

 function list(path,dirsOnly=false){
  assert.ok(path===''||safePath(path));
  try{const entries=JSON.parse(ssh(schoolExec('rclone lsjson '+quote(remote+path)+(dirsOnly?' --dirs-only':'')+' --max-depth 1')));return{ok:true,entries};}
  catch(e){return{ok:false,reason:failure(e)};}
 }
 const buckets=list('',true);
 emit('authenticated_bucket_inventory',buckets.ok?{ok:true,names:buckets.entries.filter(e=>e.IsDir).map(e=>e.Name)}:{ok:false,reason:buckets.reason});
 for(const target of [...new Set(['scholkit',bucket])]){
  const found=list(target);
  emit('bucket_root_check',found.ok?{bucket:target,authenticated_listing:true,entry_count:found.entries.length,backup_related_directories:found.entries.filter(e=>e.IsDir&&/^(betgenius|backups?|daily|weekly)([-_/].*)?$/i.test(e.Name)).map(e=>e.Name)}:{bucket:target,authenticated_listing:false,reason:found.reason});
 }
 for(const target of [...new Set([configured,configured+'/daily',configured+'/weekly','scholkit/betgenius'])]){
  const found=list(target);
  emit('betgenius_prefix_check',found.ok?{path:target,authenticated_listing:true,entry_count:found.entries.length,backup_directories:found.entries.filter(e=>e.IsDir&&/^(daily|weekly)$/i.test(e.Name)).map(e=>e.Name),dump_count:found.entries.filter(e=>!e.IsDir&&/^betgenius-.*\.dump$/.test(e.Name)).length,latest_dump:found.entries.filter(e=>!e.IsDir&&/^betgenius-.*\.dump$/.test(e.Name)).sort((a,b)=>a.Name.localeCompare(b.Name)).slice(-1).map(e=>({name:e.Name,bytes:e.Size,modified:e.ModTime}))}:{path:target,authenticated_listing:false,reason:found.reason});
 }
 emit('read_only_verification_complete',{production_written:false,credentials_printed:false,objects_created:false});
}
main().catch(e=>{emit('bucket_verification_blocked',{reason:e.name==='AssertionError'?e.message.split('\n')[0]:failure(e)});process.exitCode=1;});
