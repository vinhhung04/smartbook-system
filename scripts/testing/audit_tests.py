"""Index test cases/assertion references/skips without claiming execution coverage."""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AREAS = ('services', 'packages', 'tests', 'apps/web/e2e', 'apps/web/tests', 'apps/mobile/src')
records = []
for area in AREAS:
    for directory, children, files in os.walk(ROOT / area):
        children[:] = sorted(d for d in children if d not in {'node_modules', '.git', '__pycache__', '.hf-cache'} and not d.startswith('.venv'))
        for name in sorted(files):
            if not (re.search(r'\.(test|spec)\.(js|ts|mjs|cjs|tsx)$', name) or (name.startswith('test_') and name.endswith('.py'))):
                continue
            path = Path(directory) / name
            source = path.read_text(encoding='utf-8-sig', errors='replace')
            cases = [m.group(2) for m in re.finditer(r'''(?:test|it)(?:\.(?:skip|only))?\(\s*(['"])((?:\\.|(?!\1).)*)\1''', source)]
            cases += re.findall(r'^\s*(?:async )?def (test_[^(]+)', source, re.M)
            records.append({
                'path': path.relative_to(ROOT).as_posix(),
                'cases': cases,
                'assertionReferences': len(re.findall(r'\bassert(?:\.|\()|\bexpect(?:\.|\()', source)),
                'skipConditions': [line.strip() for line in source.splitlines() if re.search(r'test\.skip|skipUnless|skipIf|skipif|skip =', line)],
            })
target = ROOT / 'docs/testing/TEST_INVENTORY.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(sorted(records, key=lambda r: r['path']), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Indexed {len(records)} source test files; execution results are reported separately.')
