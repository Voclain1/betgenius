"""Run on the VPS over SSH: repair only BetGenius backup settings, never the DB.

Explicit manual workflow only. Credentials remain inside this host process.
The existing School Kit reader already authenticates to the intended bucket.
"""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from datetime import datetime, timezone

BASE = Path('/opt/betgenius')
PREFIX = 'school-kit-backups/betgenius'
FIELDS = ['RCLONE_CONFIG_BACKUP_ENDPOINT', 'RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID',
          'RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY']
COMPOSE = ['docker', 'compose', '--env-file', 'deploy.env']


def run(args, data=None):
    # Never include subprocess output or arguments in exceptions: may contain secrets.
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=BASE)
    if p.returncode:
        raise RuntimeError('operation failed (output withheld)')
    return p.stdout


def emit(kind, **data):
    print(json.dumps(dict(kind=kind, **data)), flush=True)


def ops(script, data=None):
    return run(COMPOSE + ['exec', '-T', 'ops', 'sh', '-c', '. /ops/env.sh; ' + script], data)


def service_id(name):
    return run(COMPOSE + ['ps', '-q', name]).strip()


def inventory():
    return json.loads(ops('rclone lsjson "backup:${BACKUP_BUCKET}/daily" --files-only'))


def main():
    assert os.environ.get('APPROVED_BACKUP_REPAIR') == 'yes'
    before = {name: service_id(name) for name in ['app', 'postgres']}
    assert all(before.values())
    candidates = run(['docker', 'ps', '--filter', 'label=com.docker.compose.service=ops',
                      '--format', '{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}']).decode().splitlines()
    readers = [x.split()[0] for x in candidates if re.search('school|scholkit|naija', x, re.I)]
    assert len(readers) == 1 and re.fullmatch('[a-f0-9]{12,64}', readers[0])
    source_script = 'if [ -r /ops/env.sh ]; then . /ops/env.sh; fi; printf "%s\\0" ' + ' '.join('"${' + k + '}"' for k in FIELDS)
    values = run(['docker', 'exec', readers[0], 'sh', '-c', source_script]).decode().split('\0')[:-1]
    assert len(values) == 3
    assert re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com/?', values[0])
    assert re.fullmatch('[a-fA-F0-9]{32}', values[1])
    assert re.fullmatch('[a-fA-F0-9]{64}', values[2])
    assert ops('printf %s "$BACKUP_BUCKET"').decode() == PREFIX
    payload = ('\n'.join(values) + '\n').encode()
    # Candidate credentials enter only this process through stdin, never argv/logs.
    candidate = '; '.join('IFS= read -r ' + k for k in FIELDS)
    candidate += '; export ' + ' '.join(FIELDS)
    candidate += '; exec rclone lsjson "backup:${BACKUP_BUCKET}/daily" --files-only'
    listing = json.loads(ops(candidate, payload))
    assert any(x.get('Name', '').startswith('betgenius-') and x.get('Size', 0) > 1024 for x in listing)
    emit('candidate_authenticated', prefix=PREFIX, archive_count=len(listing))

    path = BASE / 'ops.env'
    original = path.read_bytes()
    original_stat = path.stat()
    text = original.decode()
    changed = []
    for key, value in zip(FIELDS, values):
        pattern = re.compile(r'^' + key + r'=.*$', re.M)
        assert len(pattern.findall(text)) == 1, 'one assignment required per field'
        replacement = key + '=' + value
        if pattern.search(text).group() != replacement:
            changed.append(key)
        text = pattern.sub(lambda _: replacement, text)
    assert changed, 'configuration already repaired; inspect instead of repeating'
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    rollback = BASE / ('ops.env.before-backup-repair-' + stamp)
    fd = os.open(rollback, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(original)
    temporary = BASE / ('ops.env.repair-' + stamp)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(text.encode())
    os.chown(temporary, original_stat.st_uid, original_stat.st_gid)
    os.replace(temporary, path)
    try:
        run(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'ops'])
        assert {name: service_id(name) for name in before} == before
        after = inventory()
        assert after
        emit('backup_storage_repaired', changed_fields=changed, prefix=PREFIX,
             app_and_postgres_containers_unchanged=True, rollback_file=rollback.name,
             github_secret_synchronized=False)
        # Run precisely the deployed scheduled backup, only after proving no
        # pre-existing objects qualify for its retention deletion.
        expected = 'be27c9893a8d369bff5f44e47673fc1abb0022df223ecf98a77cd767a1cd4ed3'
        actual = ops('sha256sum /ops/backup.sh').decode().split()[0]
        assert actual == expected, 'deployed backup script differs from review'
        for folder, age in [('daily', '15d'), ('weekly', '57d')]:
            old = ops('rclone lsjson --files-only --min-age ' + age + ' "backup:${BACKUP_BUCKET}/' + folder + '"')
            assert json.loads(old) == [], 'retention candidates require separate review'
        result = ops('exec /ops/backup.sh').decode()
        success = re.findall(r'\d{4}-\d{2}-\d{2}T[0-9:]+Z backup ok: betgenius-[0-9TZ-]+\.dump, \d+ bytes', result)
        assert len(success) == 1
        emit('scheduled_backup_script_passed', message=success[0], production_database_written=False)
        emit('backup_inventory_after', daily=inventory())
    except Exception:
        # Restore original configuration if the repair/test fails. Keep backup
        # objects for recovery; never change the app, postgres or database data.
        path.write_bytes(original)
        os.chmod(path, 0o600)
        run(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'ops'])
        emit('repair_rolled_back', app_and_postgres_containers_unchanged={name: service_id(name) for name in before} == before)
        raise


try:
    main()
except Exception as exc:
    emit('backup_repair_blocked', error_type=type(exc).__name__)
    raise SystemExit(1)
