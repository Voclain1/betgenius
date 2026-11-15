/** Production source: SELECTs, metadata/list/GET only. Restores only into the job's isolated Docker service. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {promises as dns} from 'node:dns';
const approvedPlan='99ee9f0cc4270ca7dbec0842c215545c9023146e8be3335769a1c3795eea15b6';
const manifestSql=readFileSync(new URL('./backup-schema-manifest.sql',import.meta.url),'utf8');
const snapshotSql=readFileSync(new URL('./readonly-backup-snapshot.sql',import.meta.url),'utf8');
const emit=(kind,value)=>console.log(JSON.stringify({kind,...value}));
const sha=x=>createHash('sha256').update(x).digest('hex');
const backupName=/^betgenius-\d{4}-\d{2}-\d{2}T\d{4}Z\.dump$/;
function newest(items){return items.filter(x=>!x.IsDir&&backupName.test(x.Name)&&x.Size>1024).sort((a,b)=>a.Name.localeCompare(b.Name)).at(-1);}
function classifyError(s){return /AccessDenied|InvalidAccessKey|SignatureDoesNotMatch/i.test(s)?'storage-authentication-or-authorization':/NoSuchBucket|bucket.*not.*exist/i.test(s)?'storage-bucket-missing':/didn.t find section|failed to create file system/i.test(s)?'storage-remote-configuration':'storage-or-transport-error';}
const roUrl=raw=>{const u=new URL(raw);u.searchParams.set('options','-c default_transaction_read_only=on -c statement_timeout=15000');return u.toString();};
const remoteBase='cd /opt/betgenius && docker compose --env-file deploy.env';
let storageReader;
const ops=script=>`${remoteBase} exec -T ops sh -c ${quote('. /ops/env.sh; '+script)}`;
function quote(s){return "'"+s.replaceAll("'","'\\''")+"'";}
function ssh(command,input){
 try{return execFileSync('ssh',['-o','BatchMode=yes','vps',command],{input,encoding:'utf8',timeout:45000,stdio:['pipe','pipe','pipe']});}
 catch(e){const msg=String(e.stderr??'');e.category=/service.*not running/i.test(msg)?'production-service-unavailable':/Permission denied|Could not resolve|Connection refused|timed out/i.test(msg)?'ssh-or-service-access':/env.sh.*(not found|No such file)/i.test(msg)?'ops-environment-file-missing':'remote-read-only-probe-failed';throw e;}
}
async function storageConfigurationEvidence(){
 // Endpoints are read only into process memory. Never print credentials, URL
 // userinfo, paths, queries, or complete environment/configuration files.
 const credentialShapeScript=[
  'id=${RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID-}', 'key=${RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY-}',
  "if [ \"${#id}\" -eq 32 ] && printf %s \"$id\" | grep -Eq '^[0-9a-fA-F]+$'; then echo access_key_r2_hex32_shape=true; else echo access_key_r2_hex32_shape=false; fi",
  "if [ \"${#key}\" -eq 64 ] && printf %s \"$key\" | grep -Eq '^[0-9a-fA-F]+$'; then echo secret_key_r2_hex64_shape=true; else echo secret_key_r2_hex64_shape=false; fi",
  "case \"${BACKUP_BUCKET-}\" in *'<'*|*'>'*|*'${'*|*YOUR_*|*REPLACE*|*CHANGEME*) echo bucket_has_template_markers=true;; *) echo bucket_has_template_markers=false;; esac",
 ].join('; ');
 emit('backup_credential_format',{checks:ssh(ops(credentialShapeScript)).trim().split('\n'),authentication_verified:false});
 const raw=ssh(ops('printf "%s\\0" "${RCLONE_CONFIG_BACKUP_ENDPOINT-}" "${RCLONE_CONFIG_BACKUP_TYPE-}" "${RCLONE_CONFIG_BACKUP_PROVIDER-}" "${RCLONE_CONFIG_BACKUP_REGION-}" "${RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE-}"'));
 const fields=raw.split('\0');const [endpoint,type,provider,region,pathStyle]=fields;
 const clean=(v,pattern)=>pattern.test(v??'')?v:v?'(set, unexpected format)':'(unset)';
 const settings={type:clean(type,/^(s3|b2|azureblob|sftp)$/),provider:clean(provider,/^(Other|AWS|Backblaze|Cloudflare|DigitalOcean|Wasabi|Minio|Ceph|Dreamhost|Alibaba|TencentCOS|IBMCOS)$/),region:clean(region,/^[a-z0-9-]{1,40}$/),force_path_style:clean(pathStyle,/^(true|false)$/)};
 const containerEndpoint=ssh(remoteBase+' exec -T ops sh -c '+quote('printf %s "${RCLONE_CONFIG_BACKUP_ENDPOINT-}"'));
 const fileEndpoint=ssh("cd /opt/betgenius && sed -n 's/^RCLONE_CONFIG_BACKUP_ENDPOINT=//p' ops.env").trim().replace(/^(["'])(.*)\1$/,'$2');
 const ns=ssh(ops("awk '$1 == \"nameserver\" {print $2}' /etc/resolv.conf")).trim().split('\n').filter(x=>/^[0-9a-f:.]+$/i.test(x));
 const configEvidence={saved_env_matches_container:endpoint===containerEndpoint,host_ops_file_matches_container:fileEndpoint===containerEndpoint,container_nameservers:ns};
 const trimmed=endpoint.trim();const normalized=trimmed.replace(/^(["'])(.*)\1$/s,'$2').replace(/^<(.*)>$/s,'$1').trim();
 const shape={returned_fields:fields.length,endpoint_length:endpoint.length,has_surrounding_whitespace:trimmed!==endpoint,has_quote_wrappers:/^(["']).*\1$/s.test(trimmed),has_angle_wrappers:/^<.*>$/s.test(trimmed),contains_whitespace:/\s/.test(trimmed),contains_template_markers:/<|>|\$\{|YOUR_|REPLACE|CHANGEME|object storage URL/i.test(trimmed)};
 let u;try{u=new URL(normalized.includes('://')?normalized:'https://'+normalized);}catch{emit('storage_configuration',{...settings,...shape,...configEvidence,endpoint_parseable:false,normalization_would_change:normalized!==endpoint,container_control_dns:ssh(ops('if getent hosts example.com >/dev/null 2>&1; then echo resolves; else echo unresolved; fi')).trim(),runner_control_dns:await dns.resolve4('example.com').then(()=> 'resolves',e=>e.code)});return;}
 emit('storage_endpoint_shape',{...shape,normalization_would_change:normalized!==endpoint});
 const probe=host=>`if getent hosts ${quote(host)} >/dev/null 2>&1; then echo resolves; else echo unresolved; fi`;
 const hostDns=ssh(probe(u.hostname)).trim();
 const containerDns=ssh(ops(probe(u.hostname))).trim();
 const control=ssh(ops(probe('example.com'))).trim();
 const addresses=await dns.resolve4(u.hostname).then(x=>({status:'resolved',addresses:x}),e=>({status:e.code||'dns-error'}));
 emit('storage_configuration',{
  endpoint_hostname:u.hostname,endpoint_protocol:u.protocol,endpoint_port:u.port||'(default)',
  endpoint_has_url_credentials:!!(u.username||u.password),endpoint_has_path_or_query:!!(u.search||u.pathname!=='/'),
  type:clean(type,/^(s3|b2|azureblob|sftp)$/),provider:clean(provider,/^(Other|AWS|Backblaze|Cloudflare|DigitalOcean|Wasabi|Minio|Ceph|Dreamhost|Alibaba|TencentCOS|IBMCOS)$/),
  region:clean(region,/^[a-z0-9-]{1,40}$/),force_path_style:clean(pathStyle,/^(true|false)$/),
  saved_env_matches_container:endpoint===containerEndpoint,host_ops_file_matches_container:fileEndpoint===containerEndpoint,
  container_nameservers:ns,host_dns:hostDns,container_dns:containerDns,container_control_dns:control,runner_dns:addresses,
 });
}
function backupDnsEvidence(failedHost){
 const safeHost=/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(failedHost??'')?failedHost:'';
 const script=[
  'host=${RCLONE_CONFIG_BACKUP_ENDPOINT-}', 'host=${host#*://}', 'host=${host%%/*}', 'host=${host##*@}', 'host=${host%%:*}',
  'lower=$(printf %s "$host" | tr "[:upper:]" "[:lower:]")',
  'echo endpoint_hostname_sha256=$(printf %s "$lower" | sha256sum | cut -d " " -f 1)',
  'case "$lower" in example.com|*.example.com|example.net|*.example.net|example.org|*.example.org|*.invalid) echo reserved_example_or_invalid_domain=true;; *) echo reserved_example_or_invalid_domain=false;; esac',
  'if command -v getent >/dev/null; then echo dns_tool=getent; if getent hosts "$host" >/dev/null 2>&1; then echo endpoint_dns_resolves=true; else echo endpoint_dns_resolves=false; fi; if getent hosts example.com >/dev/null 2>&1; then echo control_dns_resolves=true; else echo control_dns_resolves=false; fi; else echo dns_tool=unavailable; fi',
  ...(safeHost?['if command -v getent >/dev/null; then if getent hosts '+quote(safeHost)+' >/dev/null 2>&1; then echo failed_request_host_resolves=true; else echo failed_request_host_resolves=false; fi; fi']:[]),
 ].join('; ');
 try{emit('backup_dns_evidence',{failed_request_hostname_sha256:safeHost?sha(safeHost.toLowerCase()):null,checks:ssh(ops(script)).trim().split('\n')});}
 catch(e){emit('backup_dns_probe_blocked',{reason:e.category??e.name});}
}
function inventory(prefix){
 assert.ok(['daily','weekly'].includes(prefix));let raw;
 try{raw=ssh((storageReader||ops)('exec rclone lsjson "backup:${BACKUP_BUCKET}/'+prefix+'" --files-only'));return JSON.parse(raw);}
 catch(e){
  const stderr=String(e.stderr??'');
  const tokens=[...new Set(stderr.match(/AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|NoSuchBucket|InvalidBucketName|ExpiredToken|InvalidToken|AuthorizationHeaderMalformed|RequestTimeTooSkewed|AllAccessDisabled|InvalidArgument|InvalidRequest|NoCredentials|InvalidEndpoint|directory not found|no such host|connection refused|i\/o timeout|TLS handshake|x509|unsupported protocol scheme|unknown flag|unknown command|failed to create file system|didn.t find section|\b(?:400|401|403|404|429|500|502|503)\b/gi)??[])];
  e.category=raw!==undefined?'backup-inventory-invalid-json':classifyError(stderr);
  emit('backup_inventory_error',{prefix,category:e.category,error_type:e.name,exit_status:e.status??null,signal:e.signal??null,safe_error_tokens:tokens,stdout_bytes:raw?.length??null,stderr_bytes:stderr.length});
  if (/no such host/i.test(stderr)) backupDnsEvidence(stderr.match(/lookup\s+([a-z0-9.-]+)/i)?.[1]);
  throw e;
 }
}
function opsSnapshot(){const s=JSON.parse(ssh(ops('export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000"; exec psql -XAt -v ON_ERROR_STOP=1'),snapshotSql));assert.equal(s.read_only,'on');return s;}
function validateSnapshot(s){assert.equal(s.read_only,'on');assert.equal(s.database,'betgenius');assert.equal(s.in_recovery,false);assert.equal(s.ddl_candidates.length,0,'active possible DDL');assert.equal(s.ddl_locks.length,0,'active possible schema lock');}
function run(command,args,{inputFile,outputFile}={}){
 return new Promise((resolve,reject)=>{
  const p=spawn(command,args,{stdio:['pipe',outputFile?'pipe':'ignore','pipe']});let stderr='';
  p.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-16000);});
  const out=outputFile?createWriteStream(outputFile,{mode:0o600}):null;if(out)p.stdout.pipe(out);
  if(inputFile)createReadStream(inputFile).pipe(p.stdin);else p.stdin.end();
  p.on('error',reject);p.on('close',code=>{const done=()=>code===0?resolve():reject(Object.assign(new Error('isolated operation failed'),{exitCode:code,category:classifyError(stderr)}));if(out&&!out.writableFinished)out.once('finish',done);else done();});
 });
}
async function main(){
 if(process.argv.includes('--self-test')){
  assert.equal(newest([]),undefined);assert.equal(newest([{Name:'other',Size:999999}]),undefined);
  assert.equal(newest([{Name:'betgenius-2026-11-14T0230Z.dump',Size:2000},{Name:'betgenius-2026-11-15T0230Z.dump',Size:3000}]).Size,3000);
  assert.equal(classifyError('AccessDenied'),'storage-authentication-or-authorization');
  assert.equal(classifyError('NoSuchBucket'),'storage-bucket-missing');
  assert.equal(classifyError('failed to create file system'),'storage-remote-configuration');
  assert.equal(new URL(roUrl('postgresql://u:p@localhost/db')).searchParams.get('options'),'-c default_transaction_read_only=on -c statement_timeout=15000');
  assert.equal(execFileSync("sh",["-c","printf %s "+quote("a'b")],{encoding:"utf8"}),"a'b");
  assert.throws(()=>validateSnapshot({read_only:'off'}));
  assert.throws(()=>validateSnapshot({read_only:'on',database:'betgenius',in_recovery:false,ddl_candidates:[{}],ddl_locks:[]}));
  emit('self_test',{passed:true});return;
 }
 assert.equal(process.env.OPERATIONAL_READ_ONLY_AUDIT,'yes');
 assert.equal(process.env.DB_ON_VPS,'true','VPS source must match configured production target');
 const localContainer=process.env.AUDIT_LOCAL_PG_CONTAINER;assert.match(localContainer??'',/^[a-f0-9]{12,64}$/);
 const dir=process.env.AUDIT_DIR;assert.ok(dir);mkdirSync(dir,{recursive:true,mode:0o700});
 const dump=join(dir,'restore.dump');let db;let timer;let monitoringError=null;const observations=[];
 try{
  const {PrismaClient}=await import('@prisma/client');
  const url=roUrl(process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL);
  db=new PrismaClient({datasources:{db:{url}}});
  emit('audit_phase',{stage:'running-app-target'});
  const appScript="try { const u=new URL(process.env.DATABASE_URL); console.log(JSON.stringify({database:u.pathname.slice(1),host:u.hostname,port:u.port||'5432',role:u.username,experiment:process.env.VIP_QUOTA_EXPERIMENT||'(unset)'})); } catch { process.exit(2); }";
  const app=JSON.parse(ssh(remoteBase+' exec -T app node -e '+quote(appScript)));
  emit('running_app_target',app);assert.equal(app.host,'postgres');assert.equal(app.database,'betgenius');assert.equal(app.port,'5432');assert.notEqual(app.experiment,'on');
  emit('audit_phase',{stage:'read-only-production-and-repository-targets'});
  const live=opsSnapshot();validateSnapshot(live);observations.push(live);emit('production_start',live);
  const [repoRow]=await db.$queryRawUnsafe(snapshotSql);const repo=repoRow.evidence;validateSnapshot(repo);
  assert.equal(repo.cluster_id,live.cluster_id,'repository secret and ops target different clusters');assert.equal(repo.database,app.database);assert.equal(repo.role,app.role);assert.equal(repo.schema_fingerprint,live.schema_fingerprint);
  emit('repository_target_verified',{database:repo.database,cluster_id:repo.cluster_id,server_version:repo.server_version,read_only:repo.read_only});
  const inspectPlan=()=>{
   const plan=execFileSync('node_modules/.bin/prisma',['migrate','diff','--from-schema-datasource','prisma/schema.prisma','--to-schema-datamodel','prisma/schema.prisma','--script'],{env:{...process.env,DATABASE_URL:url,DATABASE_URL_UNPOOLED:url},encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
   const hash=sha(plan);emit('read_only_schema_plan',{sha256:hash,matches_reviewed:hash===approvedPlan});assert.equal(hash,approvedPlan,'live plan differs from reviewed SQL');return hash;
  };
  inspectPlan();
  const [liveManifestRow]=await db.$queryRawUnsafe(manifestSql);const liveManifest=liveManifestRow.manifest;
  emit('live_schema_manifest',liveManifest);
  if(process.env.USE_SCHOOLKIT_BACKUP_READER==='true'){
   const candidates=ssh('docker ps --filter label=com.docker.compose.service=ops --format '+quote('{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}')).trim().split('\n').filter(x=>/school|scholkit|naija/i.test(x));
   assert.equal(candidates.length,1,'one School Kit reader required');const id=candidates[0].split(/\s+/)[0];assert.match(id,/^[a-f0-9]{12,64}$/);
   storageReader=script=>'docker exec '+id+' sh -c '+quote('if [ -r /ops/env.sh ]; then . /ops/env.sh; fi; '+script);
   // Keep School Kit's authenticated reader; change only this process's prefix.
   const reader=storageReader;storageReader=script=>reader('export BACKUP_BUCKET=school-kit-backups/betgenius; '+script);
   emit('backup_reader',{source:'existing-school-kit-remote',prefix:'school-kit-backups/betgenius',production_configuration_changed:false});
  }
  emit('audit_phase',{stage:'backup-environment-and-inventory'});
  await storageConfigurationEvidence();
  const config=ssh(ops('for n in BACKUP_BUCKET RCLONE_CONFIG_BACKUP_TYPE RCLONE_CONFIG_BACKUP_PROVIDER RCLONE_CONFIG_BACKUP_ENDPOINT RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY; do v=$(printenv "$n" || true); if [ -n "$v" ]; then echo "$n=set"; else echo "$n=unset"; fi; done'));
  emit('backup_environment',{presence:config.trim().split('\n')});
  // Only successful backup log lines are returned, never raw container logs/config.
  const logLines=ssh(`${remoteBase} logs --no-color --since 72h ops 2>/dev/null | sed -nE 's/.*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z backup ok: betgenius-[0-9TZ-]+\\.dump, [0-9]+ bytes).*/\\1/p' | tail -5`);
  emit('recent_backup_success_logs',{lines:logLines.trim().split('\n').filter(Boolean)});
  const daily=inventory('daily'),weekly=inventory('weekly');const latest=newest(daily);const weeklyLatest=newest(weekly);
  emit('backup_inventory',{daily_files:daily.length,weekly_files:weekly.length,latest_daily:latest?{name:latest.Name,bytes:latest.Size,modified:latest.ModTime}:null,latest_weekly:weeklyLatest?{name:weeklyLatest.Name,bytes:weeklyLatest.Size,modified:weeklyLatest.ModTime}:null});
  assert.ok(latest,'no daily backup available: discovery/availability failure, no restore performed');
  const ageHours=(Date.now()-Date.parse(latest.ModTime))/3600000;
  emit('backup_freshness',{age_hours:ageHours,max_age_hours:30});
  // Still test an available stale dump; freshness remains a final blocking condition.
  assert.ok(Number.isFinite(ageHours)&&ageHours>=-0.0834,'invalid/future backup timestamp');
  timer=setInterval(()=>{try{const s=opsSnapshot();validateSnapshot(s);assert.equal(s.schema_fingerprint,live.schema_fingerprint);observations.push(s);}catch(e){monitoringError=e;}},15000);
  await run('ssh',['-o','BatchMode=yes','vps',(storageReader||ops)('exec rclone cat "backup:${BACKUP_BUCKET}/daily/'+latest.Name+'"')],{outputFile:dump});
  const bytes=readFileSync(dump);assert.equal(bytes.length,latest.Size);emit('download_verified',{bytes:bytes.length,sha256:sha(bytes)});
  // pg_restore --list stops reading after the TOC; piping the entire archive can EPIPE.
  // Copy only into the disposable service, then read its local file for both operations.
  const isolatedDump='/tmp/betgenius-restore.dump';
  execFileSync('docker',['cp',dump,localContainer+':'+isolatedDump],{stdio:'pipe',timeout:60000});
  const toc=execFileSync('docker',['exec',localContainer,'pg_restore','--list',isolatedDump],{encoding:'utf8',timeout:60000,stdio:['pipe','pipe','pipe']});
  emit('archive_metadata',{lines:toc.split('\n').filter(x=>/^;.*(dbname:|Dumped from database version:|Dumped by pg_dump version:|Dump Version:|TOC Entries:|Archive created at)/.test(x))});
  assert.equal(toc.match(/^;.*dbname:\s+([^\r\n]+)$/m)?.[1].trim(),live.database,'archive belongs to another database');
  await run('docker',['exec',localContainer,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','audit','-d','restore_audit',isolatedDump]);
  const countSql=`SELECT json_build_object('database',current_database(),'User',(SELECT count(*) FROM "User"),'Prediction',(SELECT count(*) FROM "Prediction"),'Subscription',(SELECT count(*) FROM "Subscription"),'PaymentAttempt',(SELECT count(*) FROM "PaymentAttempt"));`;
  const restored=JSON.parse(execFileSync('docker',['exec','-i',localContainer,'psql','-U','audit','-d','restore_audit','-XAt','-v','ON_ERROR_STOP=1'],{input:countSql,encoding:'utf8',timeout:30000}));
  for(const table of Object.keys(live.counts))if(live.counts[table]>0)assert.ok(restored[table]>0,`restored ${table} empty`);
  const restoredManifestRow=JSON.parse(execFileSync('docker',['exec','-i',localContainer,'psql','-U','audit','-d','restore_audit','-XAt','-v','ON_ERROR_STOP=1'],{input:manifestSql,encoding:'utf8',timeout:30000}));
  emit('restored_schema_manifest',restoredManifestRow);
  assert.equal(restoredManifestRow.schema_fingerprint,liveManifest.schema_fingerprint,'backup/live schema definitions differ');
  assert.equal(restoredManifestRow.table_count,liveManifest.table_count);assert.equal(restoredManifestRow.invalid_indexes,0);assert.equal(restoredManifestRow.unvalidated_constraints,0);
  emit('isolated_restore_passed',{...restored,production_database_written:false});
  if(timer){clearInterval(timer);timer=null;}if(monitoringError)throw monitoringError;
  const end=opsSnapshot();validateSnapshot(end);assert.equal(end.schema_fingerprint,live.schema_fingerprint);observations.push(end);inspectPlan();
  const after=newest(inventory('daily'));assert.equal(after.Name,latest.Name);assert.equal(after.Size,latest.Size);assert.equal(after.ModTime,latest.ModTime);
  emit('schema_observation_window',{start:live.at,end:end.at,samples:observations.length,fingerprint:end.schema_fingerprint,active_ddl_or_schema_locks:0});
  assert.ok(ageHours<=30,'latest daily backup older than 30h');
  emit('operational_verdict',{target_verified:true,daily_backup_fresh:true,isolated_restore_passed:true,schema_stable_during_observations:true,production_written:false});
 }finally{if(timer)clearInterval(timer);await db?.$disconnect();rmSync(dump,{force:true});}
}
main().catch(e=>{emit('audit_blocked',{reason:e.name==='AssertionError'?e.message.split('\n')[0]:e.category||e.code||e.name});process.exitCode=1;});
