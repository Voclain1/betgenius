"""Read-only secret-safe verification of the approved pending quota settings."""
import json,os,shlex,subprocess,sys
REMOTE=r'''
import json, re, stat, subprocess, sys
from pathlib import Path
stage='input'
def parse(text):
    out={}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        m=re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*',line)
        assert m and m[1] not in out
        v=m[2]
        if len(v)>1 and v[0]==v[-1] and v[0] in ('"',"'"):v=v[1:-1]
        out[m[1]]=v
    return out
def run(args):
    result=subprocess.run(args,capture_output=True,text=True,timeout=45)
    assert result.returncode==0
    return result.stdout
try:
    payload=json.load(sys.stdin)
    root=Path('/opt/betgenius')
    backup=root/'private-config-backups/20261116T232325Z-quota-disabled'
    app=parse((root/'app.env').read_bytes().decode())
    incoming=parse(payload['incoming'])
    deploy=parse((root/'deploy.env').read_bytes().decode())
    prepared=(backup/'incoming-staged.env').read_bytes().decode()
    norm=lambda s:s.replace('\r\n','\n').rstrip('\n')
    expected={'VIP_QUOTA_EXPERIMENT':'off','VIP_QUOTA_EXTRA_ATTEMPTS':'2','VIP_QUOTA_INCREMENTAL_DAILY_USD':'0.30','VIP_QUOTA_INPUT_USD_PER_MILLION':'0.50','VIP_QUOTA_OUTPUT_USD_PER_MILLION':'2.50'}
    stage='running-containers'
    compose=['docker','compose','--env-file',str(root/'deploy.env'),'-f',str(root/'docker-compose.yml')]
    containers={}
    for service in ('app','postgres','ops'):
        cid=run(compose+['ps','-q',service]).strip()
        obj=json.loads(run(['docker','inspect',cid]))[0]
        containers[service]={'id':obj['Id'],'image':obj['Config']['Image'],'startedAt':obj['State']['StartedAt'],'restartCount':obj['RestartCount'],'running':obj['State']['Running'],'health':obj['State'].get('Health',{}).get('Status')}
    compiled_probe="""const fs=require('fs'),path=require('path');let text='';function scan(p){if(!fs.existsSync(p))return;const s=fs.statSync(p);if(s.isDirectory()){for(const n of fs.readdirSync(p))scan(path.join(p,n));}else if(p.endsWith('.js'))text+=fs.readFileSync(p,'utf8');}scan('.next/server/chunks');scan('.next/server/app/api/admin/generate/run/route.js');console.log(JSON.stringify({buildId:/^[a-f0-9]{40}$/.test(process.env.APP_BUILD_ID||'')?process.env.APP_BUILD_ID:null,evidenceErrorBundled:text.includes('PaidPublicationEvidenceError'),evidenceRejectionBundled:text.includes('Paid publication evidence rejected:'),publicationHoldBundled:text.includes('INVALID_PUBLICATION_EVIDENCE')}));"""
    compiled=json.loads(run(compose+['exec','-T','app','node','-e',compiled_probe]))
    keys=sorted(set(app)|set(expected)|{'VIP_QUOTA_PRICE_VALID_UNTIL'})
    script='const keys='+json.dumps(keys)+';console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,process.env[k]??null]))))'
    runtime=json.loads(run(compose+['exec','-T','app','node','-e',script]))
    rendered=dict(incoming)
    for key in ('DATABASE_URL','DATABASE_URL_UNPOOLED'):
        rendered[key]='postgresql://betgenius:'+payload['postgres_password']+'@postgres:5432/betgenius'
    if payload['anthropic_key']:rendered['ANTHROPIC_API_KEY']=payload['anthropic_key']
    metadata=json.loads((backup/'metadata.json').read_text())
    old=parse((backup/'app.env').read_bytes().decode())
    differences={k for k in set(old)|set(app) if old.get(k)!=app.get(k)}
    result={'kind':'disabled_staging_verification','incomingMatchesPreparedFile':norm(payload['incoming'])==norm(prepared),'incomingApprovedValues':{k:incoming.get(k)==v for k,v in expected.items()},'appFileApprovedValues':{k:app.get(k)==v for k,v in expected.items()},'runningApprovedValues':{k:runtime.get(k)==v for k,v in expected.items()},'safeRunningValues':{k:runtime.get(k) if runtime.get(k) in (None,expected[k]) else '(unexpected; value withheld)' for k in expected},'priceExpiryAbsent':{'incoming':not incoming.get('VIP_QUOTA_PRICE_VALID_UNTIL'),'appFile':not app.get('VIP_QUOTA_PRICE_VALID_UNTIL'),'running':not runtime.get('VIP_QUOTA_PRICE_VALID_UNTIL')},'incomingRendersToAppFile':rendered==app,'allAppFileKeysLoaded':all(runtime.get(k)==v for k,v in app.items()),'onlyApprovedAppSettingsDifferFromBackup':differences<=set(expected),'opsSettingsUnchanged':norm(payload['ops'])==norm((root/'ops.env').read_bytes().decode()),'approvedCommit':'4d23e7fd2fa369c8557f48c97ab071cf4dc8a4f9','deployedCommit':deploy.get('APP_TAG'),'runningImageMatchesApprovedCommit':containers['app']['image'].endswith(':4d23e7fd2fa369c8557f48c97ab071cf4dc8a4f9'),'containers':containers,'compiledGuardVerification':compiled,'postgresUnchangedSinceBackup':containers['postgres']['id']==metadata['baseline']['postgres']['id'],'opsUnchangedSinceBackup':containers['ops']['id']==metadata['baseline']['ops']['id'],'backupDirectory':str(backup),'backupPermissionsVerified':stat.S_IMODE(backup.stat().st_mode)==0o700 and all(stat.S_IMODE((backup/name).stat().st_mode)==0o600 for name in ('app.env','incoming.env','deploy.env','ops.env','incoming-staged.env')),'productionWritten':False,'deployed':False}
    print(json.dumps(result))
except Exception:
    print(json.dumps({'kind':'verification_failed','stage':stage,'valuesWithheld':True}));sys.exit(1)
'''
try:
    payload={'incoming':os.environ['PROD_ENV_FILE'],'anthropic_key':os.environ.get('ANTHROPIC_API_KEY',''),'postgres_password':os.environ['POSTGRES_PASSWORD'],'ops':os.environ['OPS_ENV_FILE']}
    result=subprocess.run(['ssh','-o','BatchMode=yes','vps','python3 -c '+shlex.quote(REMOTE)],input=json.dumps(payload),capture_output=True,text=True,timeout=120)
    rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    for row in rows:print(json.dumps(row))
    if result.returncode or not rows:raise RuntimeError('remote verification failed')
except Exception:
    print(json.dumps({'kind':'secure_verification_failed','valuesWithheld':True}));sys.exit(1)
