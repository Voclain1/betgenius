/** Reject stale R2 template settings before deployment overwrites working ops.env. */
import assert from 'node:assert/strict';
export function validateBackupSettings(text) {
 const fields={};
 for(const line of text.split(/\r?\n/)) {
  const m=line.match(/^\s*(BACKUP_BUCKET|RCLONE_CONFIG_BACKUP_[A-Z_]+)\s*=\s*(.*?)\s*$/);
  if(!m)continue;
  assert.equal(fields[m[1]],undefined,'duplicate backup setting');
  fields[m[1]]=m[2].replace(/^(["'])(.*)\1$/,'$2');
 }
 assert.ok(fields.BACKUP_BUCKET,'backup destination required');
 if(fields.RCLONE_CONFIG_BACKUP_PROVIDER==='Cloudflare') {
  assert.equal(fields.RCLONE_CONFIG_BACKUP_TYPE,'s3','R2 requires S3 remote');
  assert.match(fields.RCLONE_CONFIG_BACKUP_ENDPOINT||'',/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\/?$/,'valid R2 endpoint required');
  assert.match(fields.RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID||'',/^[a-fA-F0-9]{32}$/,'valid R2 access key format required');
  assert.match(fields.RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY||'',/^[a-fA-F0-9]{64}$/,'valid R2 secret key format required');
 }
}
if(process.argv.includes('--self-test')) {
 const valid='BACKUP_BUCKET=school-kit-backups/betgenius\nRCLONE_CONFIG_BACKUP_TYPE=s3\nRCLONE_CONFIG_BACKUP_PROVIDER=Cloudflare\nRCLONE_CONFIG_BACKUP_ENDPOINT=https://'+ 'a'.repeat(32)+'.r2.cloudflarestorage.com\nRCLONE_CONFIG_BACKUP_ACCESS_KEY_ID='+ 'b'.repeat(32)+'\nRCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY='+ 'c'.repeat(64);
 validateBackupSettings(valid);
 assert.throws(()=>validateBackupSettings(valid.replace('c'.repeat(64),'API-token-instead-of-S3-secret')));
 assert.throws(()=>validateBackupSettings(valid.replace('a'.repeat(32),'<account-id>')));
 assert.throws(()=>validateBackupSettings(valid+'\nBACKUP_BUCKET=other'));
 console.log('Backup configuration validation passed');
} else {
 try {validateBackupSettings(process.env.OPS_ENV_FILE||'');}
 catch {console.error('Invalid backup settings: synchronize OPS_ENV_FILE with verified production storage settings before deployment. Values withheld.');process.exitCode=1;}
}
