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
    current=(root/'app.env').read_text()
    incoming=payload['incoming']
    deploy=(root/'deploy.env').read_text()
    ops=(root/'ops.env').read_text()
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
        assert (directory/name).read_text()==content
        assert stat.S_IMODE((directory/name).stat().st_mode)==0o600
    with (directory/'metadata.json').open('x') as handle:
        json.dump({'baseline':baseline,'approvedCommit':deployment['APP_TAG']},handle)
    stage='authorized-github-capability'
    gh=shutil.which('gh')
    authorized=False
    if gh:
        check=run([gh,'api','repos/Voclain1/betgenius/actions/secrets/public-key'])
        if check.returncode==0:
            obj=json.loads(check.stdout); authorized=bool(obj.get('key_id') and obj.get('key'))
    print(json.dumps({'kind':'backup_preflight','backupDirectory':str(directory),'directoryMode':'0700','fileMode':'0600','backupContentsVerified':True,'incomingMatchesCurrentAppFile':True,'opsSettingsUnchanged':True,'experimentDisabled':True,'priceExpiryAbsent':True,'baseline':baseline,'vpsGhInstalled':bool(gh),'vpsGhRepositorySecretsAccess':authorized,'productionConfigurationChanged':False,'applicationRestarted':False}))
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
