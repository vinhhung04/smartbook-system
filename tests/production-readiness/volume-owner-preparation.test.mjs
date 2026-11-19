import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runShellSandbox } from './helpers/shell-sandbox.mjs';

const project = 'smartbook-qa-a1b2c3d4';
const mounts = { packing_evidence_data: '/recovery/packing', procurement_document_data: '/recovery/procurement', ai_model_cache: '/models', ai_cloakbrowser_cache: '/browser' };
function prepare(scenario, args = []) {
  return runShellSandbox('prepare-volumes.sh', { scenario, args, prepare(directory) {
    const config = { name: project, services: { 'prepare-volumes': {
      user: '0:0', network_mode: 'none', command: [],
      entrypoint: ['chown', '--no-dereference', '-R', '-P', '--', '1000:1000', ...Object.values(mounts)],
      volumes: Object.entries(mounts).map(([source, target]) => ({ type: 'volume', source, target })),
    } }, volumes: Object.fromEntries(Object.keys(mounts).map(source => [source, { name: `${project}_${source}` }])) };
    if (scenario === 'host-bind') config.services['prepare-volumes'].volumes[0].type = 'bind';
    if (scenario === 'external') config.volumes.packing_evidence_data.external = true;
    if (scenario === 'driver-options') config.volumes.packing_evidence_data.driver_opts = { device: '/never-accessed' };
    if (scenario === 'wrong-name') config.volumes.packing_evidence_data.name = 'foreign_data';
    if (scenario === 'unsafe-recursion') config.services['prepare-volumes'].entrypoint = ['chown', '-R', '1000:1000', ...Object.values(mounts)];
    if (scenario === 'extra-command') config.services['prepare-volumes'].command = ['/'];
    writeFileSync(resolve(directory, 'owner-config.json'), JSON.stringify(config));
    for (const source of Object.keys(mounts)) {
      const metadata = [{ Name: `${project}_${source}`, Driver: 'local', Options: null,
        Labels: { 'com.docker.compose.project': scenario === 'foreign-label' ? 'foreign' : project, 'com.docker.compose.volume': source } }];
      if (scenario === 'actual-bind-driver') metadata[0].Options = { device: '/never-accessed' };
      writeFileSync(resolve(directory, source + '.json'), JSON.stringify(metadata));
    }
    appendFileSync(resolve(directory, 'deploy/scripts/lib.sh'), `
jq(){ (unset MSYS_NO_PATHCONV; command jq "$@" | tr -d '\\r'); }
dc(){
  trace "OWNER_DC $*"
  case "$*" in
    'config --format json') jq 'del(.services["prepare-volumes"])' "$APP_DIR/owner-config.json" ;;
    '--profile operations config --format json') cat "$APP_DIR/owner-config.json" ;;
    '--profile operations run --rm --no-deps -T prepare-volumes') trace OWNER_RUN ;;
    *) trace "UNEXPECTED $*"; return 97 ;;
  esac
}

docker(){
  trace "OWNER_DOCKER $*"
  case "$*" in
    'volume inspect '*)
      if [[ "$OPS_TEST_SCENARIO" == missing ]]; then return 1; fi
      source="\${3#${project}_}"; cat "$APP_DIR/$source.json" ;;
    'volume ls '*) return 0 ;;
    *) trace "UNEXPECTED $*"; return 97 ;;
  esac
}
`);
  } });
}

test('owner preparation check mode verifies boundaries without changing ownership', () => {
  const result = prepare('valid', ['--check']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.trace, /^OWNER_RUN$/m);
});

for (const scenario of ['host-bind', 'external', 'driver-options', 'wrong-name', 'unsafe-recursion', 'extra-command', 'foreign-label', 'actual-bind-driver']) {
  test(`owner preparation rejects ${scenario} before any ownership operation`, () => {
    const result = prepare(scenario);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /owner|physical chown/);
    assert.doesNotMatch(result.trace, /^OWNER_RUN$/m);
  });
}
for (const scenario of ['valid', 'missing']) {
  test(`owner preparation permits ${scenario} verified project volumes through the explicit owner helper`, () => {
    const result = prepare(scenario);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.trace.match(/^OWNER_RUN$/gm) || []).length, 1);
  });
}
