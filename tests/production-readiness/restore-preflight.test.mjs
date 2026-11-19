import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { runShellSandbox } from './helpers/shell-sandbox.mjs';

function archive(name = 'safe.bin', type = '0') {
  const header = Buffer.alloc(512);
  const put = (offset, size, value) => header.write(value, offset, size, 'ascii');
  put(0, 100, name); put(100, 8, '0000644\0'); put(108, 8, '0000000\0'); put(116, 8, '0000000\0');
  put(124, 12, '00000000000\0'); put(136, 12, '00000000000\0');
  header.fill(32, 148, 156); put(156, 1, type); put(157, 100, '../outside'); put(257, 6, 'ustar\0'); put(263, 2, '00');
  put(148, 8, [...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ');
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}

const boundaries = `
export SMARTBOOK_RECOVERY_ISOLATED=1 SMARTBOOK_RECOVERY_PROJECT=smartbook-recovery-a1b2c3d4 SMARTBOOK_RECOVERY_DB_USER=qa
export SMARTBOOK_RECOVERY_COMPOSE="$APP_DIR/recovery.yml"
jq(){ (unset MSYS_NO_PATHCONV; command jq "$@" | tr -d '\\r'); }
gpg(){
  trace "GPG_HEADER $*"
  if [[ "$OPS_TEST_SCENARIO" == corrupt-db && "$*" == *borrow_db.dump.gpg ]]; then return 1; fi
  cat "\${@: -1}"
}
docker(){
  trace "RECOVERY_CLI $*"
  case "$*" in
    'compose '*' ps -q db') echo sandbox-db ;;
    'compose '*' config --format json') cat "$APP_DIR/recovery-config.json" ;;
    'inspect sandbox-db') cat "$APP_DIR/recovery-runtime.json" ;;
    'inspect sandbox-db '*) echo smartbook-recovery-a1b2c3d4 ;;
    'volume inspect '*--format*)
      if [[ "$OPS_TEST_SCENARIO" == foreign-volume ]]; then echo foreign-project; else echo smartbook-recovery-a1b2c3d4; fi ;;
    'volume inspect '*) echo '[]' ;;
    *'pg_restore --list'*)
      if [[ "$OPS_TEST_SCENARIO" == large-header || "$OPS_TEST_SCENARIO" == failed-large-header ]]; then
        pg_restore(){ head -c 32 >/dev/null; [[ "$OPS_TEST_SCENARIO" != failed-large-header ]]; }
        export -f pg_restore
        if [[ "$*" == *' sh -c '* ]]; then bash -c "\${@: -1}"; else pg_restore; fi
      else cat >/dev/null; fi ;;
    'compose '*psql*) if [[ "$OPS_TEST_SCENARIO" == nonpublic-object ]]; then echo 1; else echo 0; fi ;;
    'compose '*pg_restore*--no-owner*) trace RESTORE_WRITE; cat >/dev/null ;;
    *'--entrypoint sh'*) return 0 ;;
    *'--entrypoint tar'*) trace FILE_WRITE; cat >/dev/null ;;
    *) trace "UNEXPECTED recovery $*"; return 97 ;;
  esac
}
`;

function restore(scenario) {
  return runShellSandbox('restore.sh', { scenario, args: ['capture', '--isolated-empty-target'], prepare(directory) {
    const capture = resolve(directory, 'capture'); mkdirSync(capture);
    const config = { services: { db: { environment: {}, volumes: [{ type: 'volume', source: 'pgdata', target: '/var/lib/postgresql/data' }] },
      'recovery-files': { volumes: [{ type: 'volume', source: 'packing', target: '/recovery/packing' }, { type: 'volume', source: 'procurement', target: '/recovery/procurement' }] } },
    volumes: Object.fromEntries(['pgdata', 'packing', 'procurement'].map(name => [name, { name: `smartbook-recovery-a1b2c3d4_${name}` }])) };
    if (scenario === 'external-volume') config.volumes.pgdata.external = true;
    if (scenario === 'bind-storage') config.services.db.volumes = [{ type: 'bind', source: '/never-accessed', target: '/var/lib/postgresql/data', read_only: false }];
    writeFileSync(resolve(directory, 'recovery-config.json'), JSON.stringify(config));
    const runtime = [{ Config: { Env: ['PGDATA=/var/lib/postgresql/data'] }, Mounts: [{ Type: 'volume', Name: 'smartbook-recovery-a1b2c3d4_pgdata', Destination: '/var/lib/postgresql/data', RW: true }] }];
    if (scenario === 'actual-volume') runtime[0].Mounts[0].Name = 'foreign_volume';
    if (scenario === 'actual-pgdata') runtime[0].Config.Env = ['PGDATA=/unexpected'];
    writeFileSync(resolve(directory, 'recovery-runtime.json'), JSON.stringify(runtime));
    writeFileSync(resolve(directory, 'recovery.yml'), '# never passed to a real Docker command\n');
    const files = { 'manifest.json': JSON.stringify({ format: 2, encrypted: true, boundary: 'writers-stopped' }),
      ...Object.fromEntries(['auth', 'inventory', 'borrow', 'ai'].map(name => [`${name}_db.dump.gpg`, 'OPAQUE_TEST_DB_HEADER'])),
      'packing_evidence.tar.gz.gpg': archive(), 'procurement_evidence.tar.gz.gpg': archive() };
    if (scenario === 'large-header' || scenario === 'failed-large-header') {
      for (const name of ['auth', 'inventory', 'borrow', 'ai']) files[name + '_db.dump.gpg'] = Buffer.alloc(2 * 1024 * 1024, 65);
    }
    if (scenario === 'symlink') files['procurement_evidence.tar.gz.gpg'] = archive('safe-name', '2');
    if (scenario === 'hardlink') files['procurement_evidence.tar.gz.gpg'] = archive('safe-name', '1');
    if (scenario === 'traversal') files['procurement_evidence.tar.gz.gpg'] = archive('../outside', '0');
    if (scenario === 'missing-files') delete files['procurement_evidence.tar.gz.gpg'];
    const checksums = [];
    for (const [name, data] of Object.entries(files)) {
      writeFileSync(resolve(capture, name), data);
      checksums.push(`${createHash('sha256').update(data).digest('hex')}  ${name}`);
    }
    writeFileSync(resolve(capture, 'SHA256SUMS'), checksums.join('\n') + '\n');
    appendFileSync(resolve(directory, 'deploy/scripts/lib.sh'), boundaries);
  } });
}

for (const scenario of ['symlink', 'hardlink', 'traversal', 'missing-files', 'corrupt-db', 'nonpublic-object', 'external-volume', 'bind-storage', 'foreign-volume', 'actual-volume', 'actual-pgdata', 'failed-large-header']) {
  test(`restore preflight refuses ${scenario} before any DB/file restore write`, () => {
    const result = restore(scenario);
    assert.notEqual(result.status, 0, result.stderr);
    const reasons = { symlink: /links\/special/, hardlink: /links\/special/, traversal: /unsafe archive path/,
      'missing-files': /missing encrypted file artifact/, 'corrupt-db': /invalid encrypted database artifact/,
      'nonpublic-object': /database not empty/, 'external-volume': /external recovery volume forbidden/,
      'bind-storage': /unexpected writable\/bind recovery storage/, 'foreign-volume': /volume owner mismatch/,
      'actual-volume': /actual recovery storage mismatch/, 'actual-pgdata': /unexpected actual recovery PGDATA/,
      'failed-large-header': /invalid encrypted database artifact/ };
    assert.match(result.stderr, reasons[scenario], 'The intended validation must reject the fixture; setup/syntax failure is not proof');
    assert.doesNotMatch(result.trace, /^RESTORE_WRITE|^FILE_WRITE/m, 'Preflight must complete before the first restore write');
  });
}

test('restore preflight accepts only the isolated empty complete target and retains artifacts', () => {
  const result = restore('valid');
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.trace.match(/^RESTORE_WRITE$/gm) || []).length, 4);
  assert.equal((result.trace.match(/^FILE_WRITE$/gm) || []).length, 2);
});

test('restore preflight drains large decrypted bodies after a short header reader', () => {
  const result = restore('large-header');
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.trace.match(/^RESTORE_WRITE$/gm) || []).length, 4);
  assert.equal((result.trace.match(/^FILE_WRITE$/gm) || []).length, 2);
});
