/** Secret-safe comparison only: no files shipped, containers changed or DB connections. */
import {execFileSync} from 'node:child_process';
const emit=(kind,data)=>console.log(JSON.stringify({kind,...data}));
const requireTrue=(value)=>{if(!value)throw new Error('verification failed');};
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function ssh(command){return execFileSync('ssh',['-o','BatchMode=yes','vps',command],{encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});}
const compose='cd /opt/betgenius && docker compose --env-file deploy.env';
const ops=script=>ssh(compose+' exec -T ops sh -c '+quote('set -eu; . /ops/env.sh; '+script));
const normalize=s=>s.replaceAll('\r\n','\n').replace(/\n+$/,'');
function assignments(text){
 const result={};
 for(const line of text.split(/\r?\n/)){
  if(!line.trim()||/^\s*#/.test(line))continue;
  const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
  requireTrue(m&&!Object.hasOwn(result,m[1]));
  result[m[1]]=m[2].replace(/^(["'])(.*)\1$/,'$2');
 }
 return result;
}
let stage='secret-presence';
try{
 const secret=process.env.OPS_ENV_FILE;
 requireTrue(!!secret&&!!process.env.PROD_ENV_FILE);
 const file=ssh('cat /opt/betgenius/ops.env');
 stage='configuration-comparison';
 const fileMatches=normalize(secret)===normalize(file);
 let settings={};let parseable=true;try{settings=assignments(secret);}catch{parseable=false;}
 const liveSettings=assignments(file);
 const fields=['BACKUP_BUCKET','RCLONE_CONFIG_BACKUP_TYPE','RCLONE_CONFIG_BACKUP_PROVIDER','RCLONE_CONFIG_BACKUP_REGION','RCLONE_CONFIG_BACKUP_ENDPOINT','RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID','RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY','RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE'];
 const read='printf "%s\\0" '+fields.map(k=>'"${'+k+'-}"').join(' ');
 const saved=ops(read).split('\0').slice(0,-1);
 const container=ssh(compose+' exec -T ops sh -c '+quote(read)).split('\0').slice(0,-1);
 requireTrue(saved.length===fields.length&&container.length===fields.length);
 const fieldMatches=Object.fromEntries(fields.map((k,i)=>[k,saved[i]===(settings[k]||'')]));
 const endpointPattern=/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/;
 const validChecks={parseable,bucket_matches:settings.BACKUP_BUCKET==='school-kit-backups/betgenius',s3_type:settings.RCLONE_CONFIG_BACKUP_TYPE==='s3',cloudflare_provider:settings.RCLONE_CONFIG_BACKUP_PROVIDER==='Cloudflare',r2_endpoint_valid:endpointPattern.test(settings.RCLONE_CONFIG_BACKUP_ENDPOINT||''),access_key_format_valid:/^[a-fA-F0-9]{32}$/.test(settings.RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID||''),secret_key_format_valid:/^[a-fA-F0-9]{64}$/.test(settings.RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY||'')};
 emit('repository_secret_comparison',{entire_ops_file_matches:fileMatches,normalization:'CRLF and terminal newlines only',field_matches:fieldMatches,format_checks:validChecks,credentials_printed:false});
 for(let i=0;i<fields.length;i++)requireTrue(saved[i]===(liveSettings[fields[i]]||'')&&container[i]===saved[i]);
 requireTrue(endpointPattern.test(liveSettings.RCLONE_CONFIG_BACKUP_ENDPOINT||''));
 stage='live-endpoint-dns';
 const host=new URL(liveSettings.RCLONE_CONFIG_BACKUP_ENDPOINT).hostname;
 ops('getent hosts '+quote(host)+' >/dev/null');
 emit('live_backup_settings',{container_and_cron_backup_settings_match:true,r2_endpoint_valid:true,container_dns_resolves:true});
 // Both the incoming application settings and the running app must stay off.
 stage='experiment-flags';
 const flags=process.env.PROD_ENV_FILE.split(/\r?\n/).filter(l=>/^\s*(?:export\s+)?VIP_QUOTA_EXPERIMENT\s*=/.test(l));
 requireTrue(flags.length<=1);
 const incoming=flags.length?assignments(flags[0]).VIP_QUOTA_EXPERIMENT:undefined;
 const live=ssh(compose+' exec -T app node -e '+quote('process.stdout.write(process.env.VIP_QUOTA_EXPERIMENT||"(unset)")')).trim();
 requireTrue(incoming!=='on'&&live!=='on'&&settings.VIP_QUOTA_EXPERIMENT!=='on');
 emit('experiment_disabled',{incoming_app_settings_disabled:true,running_app_disabled:true});
 stage='authenticated-live-backup-read';
 const listing=()=>JSON.parse(ops('rclone lsjson "backup:${BACKUP_BUCKET}/daily" --files-only'));
 const files=listing().filter(x=>!x.IsDir&&/^betgenius-\d{4}-\d{2}-\d{2}T\d{4}Z\.dump$/.test(x.Name)&&x.Size>1024).sort((a,b)=>a.Name.localeCompare(b.Name));
 const latest=files.at(-1);requireTrue(!!latest);
 const age=(Date.now()-Date.parse(latest.ModTime))/3600000;requireTrue(Number.isFinite(age)&&age>=0&&age<=30);
 const checksum=ops('set -o pipefail; rclone cat "backup:${BACKUP_BUCKET}/daily/'+latest.Name+'" | sha256sum').trim().split(/\s+/)[0];
 requireTrue(/^[a-f0-9]{64}$/.test(checksum));
 const known={'betgenius-2026-11-15T1253Z.dump':'15fec36c6c683f1aae8f10c6f9d9dd1b8edbba688ee0358d6144957bc6ff2cd2'};
 if(known[latest.Name])requireTrue(checksum===known[latest.Name]);
 const after=listing().find(x=>x.Name===latest.Name);requireTrue(after&&after.Size===latest.Size&&after.ModTime===latest.ModTime);
 emit('authenticated_backup_access',{list_succeeded:true,full_object_get_succeeded:true,latest:{name:latest.Name,bytes:latest.Size,modified:latest.ModTime,age_hours:age,sha256:checksum},matches_previously_restored_archive:known[latest.Name]?true:null});
 const matched=fileMatches&&Object.values(fieldMatches).every(Boolean)&&Object.values(validChecks).every(Boolean);
 emit('configuration_verdict',{repository_secret_matches_repaired_vps:matched,shipping_current_secret_preserves_repair:matched,production_database_accessed:false,production_written:false,deployed:false});
 stage='repository-secret-must-match';requireTrue(matched);
}catch{
 // Errors can carry command output or assertion operands containing secrets.
 console.error('Secret-safe configuration verification failed at '+stage+'; values and subprocess output withheld.');process.exitCode=1;
}
