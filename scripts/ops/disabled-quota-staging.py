"""Approved ops-only backup/probe. No database access, deploy or configuration changes."""
import json, os, re, shlex, subprocess, sys
from pathlib import Path

REMOTE = r'''
import datetime, hashlib, json, os, re, shutil, stat, subprocess, sys
from pathlib import Path
stage = 'input'
def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=45)
def parse(text):
    out = {}
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        m = re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*', line)
        assert m and m[1] not in out
        v=m[2]
        if len(v)>1 and v[0]==v[-1] and v[0] in ('"', "'"): v=v[1:-1]
        out[m[1]]=v
    return out
try:
    payload=json.load(sys.stdin)
    root=Path('/opt/betgenius')
    current=(root/'app.env').read_bytes().decode('utf-8')
    incoming=payload['incoming']
    deploy=(root/'deploy.env').read_bytes().decode('utf-8')
    ops=(root/'ops.env').read_bytes().decode('utf-8')
    app_values=parse(current); incoming_values=parse(incoming); deployment=parse(deploy)
    assert deployment['APP_TAG']=='5a0fd20e7d374c0ce854b20cc86b0275de2f59ea'
    assert app_values.get('VIP_QUOTA_EXPERIMENT') in (None,'','off')
    assert incoming_values.get('VIP_QUOTA_EXPERIMENT') in (None,'','off')
    assert not app_values.get('VIP_QUOTA_PRICE_VALID_UNTIL') and not incoming_values.get('VIP_QUOTA_PRICE_VALID_UNTIL')
    expected=dict(incoming_values)
    assert deployment['POSTGRES_PASSWORD']==payload['postgres_password']
    for key in ('DATABASE_URL','DATABASE_URL_UNPOOLED'):
        expected[key]='postgresql://betgenius:'+deployment['POSTGRES_PASSWORD']+'@postgres:5432/betgenius'
    if payload['anthropic_key']: expected['ANTHROPIC_API_KEY']=payload['anthropic_key']
    assert expected==app_values, 'unapproved incoming configuration difference'
    assert ops.replace('\r\n','\n').rstrip('\n')==payload['ops'].replace('\r\n','\n').rstrip('\n')
    stage='container-baseline'
    compose=['docker','compose','--env-file',str(root/'deploy.env'),'-f',str(root/'docker-compose.yml')]
    baseline={}
    for service in ('app','postgres','ops'):
        found=run(compose+['ps','-q',service]); assert found.returncode==0 and found.stdout.strip()
        inspected=run(['docker','inspect',found.stdout.strip()]); assert inspected.returncode==0
        obj=json.loads(inspected.stdout)[0]
        baseline[service]={'id':obj['Id'],'image':obj['Config']['Image'],'startedAt':obj['State']['StartedAt'],'restartCount':obj['RestartCount'],'running':obj['State']['Running'],'health':obj['State'].get('Health',{}).get('Status')}
        assert baseline[service]['running']
    assert baseline['app']['health']=='healthy'
    assert baseline['postgres']['health']=='healthy'
    assert baseline['app']['image'].endswith(':'+deployment['APP_TAG'])
    stage='restricted-backup'
    os.umask(0o077)
    parent=root/'private-config-backups'; parent.mkdir(mode=0o700,exist_ok=True)
    assert stat.S_IMODE(parent.stat().st_mode)==0o700
    directory=parent/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-quota-disabled')
    directory.mkdir(mode=0o700)
    for name,content in [('app.env',current),('incoming.env',incoming),('deploy.env',deploy),('ops.env',ops)]:
        fd=os.open(str(directory/name),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as handle:
            handle.write(content); handle.flush(); os.fsync(handle.fileno())
        assert (directory/name).read_bytes().decode('utf-8')==content
        assert stat.S_IMODE((directory/name).stat().st_mode)==0o600
    with (directory/'metadata.json').open('x') as handle:
        json.dump({'baseline':baseline,'approvedCommit':deployment['APP_TAG']},handle)
    stage='prepare-disabled-incoming-file'
    approved={'VIP_QUOTA_EXPERIMENT':'off','VIP_QUOTA_EXTRA_ATTEMPTS':'2','VIP_QUOTA_INCREMENTAL_DAILY_USD':'0.30','VIP_QUOTA_INPUT_USD_PER_MILLION':'0.50','VIP_QUOTA_OUTPUT_USD_PER_MILLION':'2.50'}
    kept=[]
    for line in incoming.splitlines(keepends=True):
        m=re.match(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=',line)
        if not m or m[1] not in approved: kept.append(line)
    staged=''.join(kept)
    if staged and not staged.endswith('\n'): staged+='\n'
    staged+=''.join(k+'='+v+'\n' for k,v in approved.items())
    assert parse(staged)==dict(incoming_values,**approved)
    assert not parse(staged).get('VIP_QUOTA_PRICE_VALID_UNTIL')
    with (directory/'incoming-staged.env').open('x') as handle:
        handle.write(staged); handle.flush(); os.fsync(handle.fileno())
    assert stat.S_IMODE((directory/'incoming-staged.env').stat().st_mode)==0o600
    assert (directory/'app.env').read_bytes()==(root/'app.env').read_bytes()
    assert (directory/'deploy.env').read_bytes()==(root/'deploy.env').read_bytes()
    assert (directory/'ops.env').read_bytes()==(root/'ops.env').read_bytes()
    stage='authorized-github-capability'
    gh=shutil.which('gh')
    authorized=False
    authenticated=False
    permission_result='GH_NOT_INSTALLED'
    if gh:
        authenticated=run([gh,'auth','status']).returncode==0
        check=run([gh,'api','repos/Voclain1/betgenius/actions/secrets/public-key'])
        if check.returncode==0:
            obj=json.loads(check.stdout); authorized=bool(obj.get('key_id') and obj.get('key'))
            permission_result='ACCESSIBLE'
        elif not authenticated: permission_result='NO_USABLE_AUTHENTICATED_ACCOUNT'
        elif re.search(r'HTTP 403',check.stderr): permission_result='HTTP_403'
        elif re.search(r'HTTP 401',check.stderr): permission_result='HTTP_401'
        else: permission_result='REQUEST_FAILED_VALUES_WITHHELD'
    print(json.dumps({'kind':'backup_preflight','backupDirectory':str(directory),'directoryMode':'0700','fileMode':'0600','backupContentsVerified':True,'incomingMatchesCurrentAppFile':True,'opsSettingsUnchanged':True,'experimentDisabled':True,'priceExpiryAbsent':True,'baseline':baseline,'vpsGhInstalled':bool(gh),'vpsGhAuthenticated':authenticated,'vpsGhAccessResult':permission_result,'preparedIncomingFile':str(directory/'incoming-staged.env'),'preparedSettings':approved,'onlyApprovedFieldsChanged':True,'backupByteEqualityVerified':True,'vpsGhRepositorySecretsAccess':authorized,'productionConfigurationChanged':False,'applicationRestarted':False}))
except Exception:
    print(json.dumps({'kind':'backup_preflight_failed','stage':stage,'valuesWithheld':True}))
    sys.exit(1)
'''
try:
    payload={'incoming':os.environ['PROD_ENV_FILE'],'anthropic_key':os.environ.get('ANTHROPIC_API_KEY',''),'postgres_password':os.environ['POSTGRES_PASSWORD'],'ops':os.environ['OPS_ENV_FILE']}
    result=subprocess.run(['ssh','-o','BatchMode=yes','vps','python3 -c '+shlex.quote(REMOTE)],input=json.dumps(payload),capture_output=True,text=True,timeout=120)
    # Only accept structured, deliberately redacted output from the helper.
    rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    for row in rows: print(json.dumps(row))
    if result.returncode or not rows: raise RuntimeError('remote check failed')
except Exception:
    print(json.dumps({'kind':'secure_backup_driver_failed','valuesWithheld':True}))
    sys.exit(1)
