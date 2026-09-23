"""Run B1–B5 against frozen source snapshots; never alters the dataset."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))
from metadata_intelligence.pipeline import run_pipeline  # noqa: E402
from metadata_intelligence.sources import document  # noqa: E402
from metadata_scoring import aggregate, paired_delta, score_run  # noqa: E402

MODES = ('B1', 'B2', 'B3', 'B4', 'B5')


def read_dataset(path):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    entries = data['editions'] if isinstance(data, dict) else data
    if not isinstance(entries, list):
        raise ValueError('Dataset must be an array or {"editions": [...]}')
    ids, groups = set(), set()
    for item in entries:
        if not isinstance(item, dict) or not item.get('editionId') or not item.get('workGroup') or item.get('split') not in {'development', 'test'}:
            raise ValueError('Every edition needs editionId, workGroup and split')
        if item['editionId'] in ids: raise ValueError('Duplicate editionId: ' + item['editionId'])
        ids.add(item['editionId'])
        if item['workGroup'] in groups: raise ValueError('A workGroup appears more than once; freeze all editions of one work in one split')
        groups.add(item['workGroup'])
        fields = item.get('editionGold', {}).get('fields', {})
        if not isinstance(fields, dict): raise ValueError('editionGold.fields is required')
        for field, gold in fields.items():
            if not isinstance(gold, dict) or gold.get('status') not in {'known', 'absent', 'unknown', 'not_applicable'}:
                raise ValueError(f'Invalid gold status for {item["editionId"]}:{field}')
        if not isinstance(item.get('documents'), list) or not item['documents']:
            raise ValueError('Each edition needs at least one frozen source document')
    return entries


def validate_study(entries, strict):
    if not strict: return
    if len(entries) != 120: raise ValueError(f'Protocol requires 120 editions; found {len(entries)}')
    if sum(e['split'] == 'development' for e in entries) != 40 or sum(e['split'] == 'test' for e in entries) != 80:
        raise ValueError('Protocol requires 40 development and 80 held-out test editions')
    languages = [str(e.get('languageGroup', '')).casefold() for e in entries]
    if languages.count('vi') != 60 or languages.count('international') != 60:
        raise ValueError('Protocol requires 60 Vietnamese and 60 international editions')
    if sum(bool(e.get('secondAnnotator')) for e in entries) < 24:
        raise ValueError('Protocol requires at least 24 independently double-annotated editions')


def docs(entry):
    output = []
    for source in entry['documents']:
        output.append(document(source['provider'], source['kind'], source['payload'], source.get('url'), source.get('recordId', 'primary')))
    return output


async def run(entries, modes, repeats, ablations):
    import main
    try:
        provider = main._get_text_llm_provider()
    except ValueError:
        provider = None
    all_results, artifacts = {}, {}
    for mode in modes:
        results = []
        for entry in entries:
            attempts = []
            for _ in range(repeats if mode in {'B3', 'B4', 'B5'} else 1):
                bundle = await run_pipeline(docs(entry), entry.get('targetIsbn'), provider, mode=mode)
                attempts.append(bundle)
            # First attempt is the primary report. Additional attempts remain artifacts to show variance.
            results.append(score_run(entry, attempts[0]))
            artifacts.setdefault(mode, {})[entry['editionId']] = attempts
        all_results[mode] = results
    for name, options in ablations.items():
        results = []
        for entry in entries:
            bundle = await run_pipeline(docs(entry), entry.get('targetIsbn'), provider, mode='B5', **options)
            results.append(score_run(entry, bundle))
            artifacts.setdefault(name, {})[entry['editionId']] = [bundle]
        all_results[name] = results
    return all_results, artifacts


def bootstrap_delta(left, right, rounds=2000, seed=20260923):
    rng = random.Random(seed)
    groups = sorted({r['workGroup'] for r in left} & {r['workGroup'] for r in right})
    if not groups: return None
    by = lambda rows: {g: [r for r in rows if r['workGroup'] == g] for g in groups}
    l, r = by(left), by(right)
    values = []
    for _ in range(rounds):
        sample = [rng.choice(groups) for _ in groups]
        def coverage(data):
            rows = [x for g in sample for x in data[g]]
            return sum(x['correct'] for x in rows) / sum(x['eligible'] for x in rows)
        values.append(coverage(r) - coverage(l))
    values.sort()
    return {'method': 'paired bootstrap by workGroup', 'rounds': rounds, 'ci95': [values[int(.025 * rounds)], values[int(.975 * rounds) - 1]]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--output-dir', default=str(Path(__file__).parent / 'reports'))
    parser.add_argument('--modes', default=','.join(MODES))
    parser.add_argument('--repeat', type=int, default=1)
    parser.add_argument('--ablations', default='evidence-gate,edition-gate,source-priority',
                        help='comma-separated: evidence-gate,edition-gate,source-priority; empty disables')
    parser.add_argument('--strict-protocol', action='store_true')
    args = parser.parse_args()
    if args.repeat < 1: parser.error('--repeat must be positive')
    modes = tuple(mode.strip() for mode in args.modes.split(',') if mode.strip())
    if not set(modes).issubset(MODES): parser.error('modes must be B1,B2,B3,B4,B5')
    wanted = tuple(x.strip() for x in args.ablations.split(',') if x.strip())
    available = {
        'evidence-gate': {'evidence_gate': False},
        'edition-gate': {'edition_gate': False},
        'source-priority': {'fusion_policy': 'source-priority'},
    }
    if not set(wanted).issubset(available): parser.error('unknown ablation')
    ablations = {f'A_{name}': available[name] for name in wanted}
    entries = read_dataset(args.dataset)
    validate_study(entries, args.strict_protocol)
    results, artifacts = asyncio.run(run(entries, modes, args.repeat, ablations))
    report = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'dataset': str(Path(args.dataset).resolve()),
              'datasetHash': __import__('hashlib').sha256(Path(args.dataset).read_bytes()).hexdigest(),
              'config': {'modes': modes, 'ablations': wanted, 'repeat': args.repeat, 'strictProtocol': args.strict_protocol,
                         'model': os.getenv('OPENROUTER_TEXT_MODEL', 'qwen/qwen3.7-flash'), 'temperature': 0},
              'summary': {mode: aggregate(rows) for mode, rows in results.items()},
              'pairedDeltas': {}, 'perEdition': results}
    if 'B1' in results and 'B5' in results:
        report['pairedDeltas']['B5_minus_B1'] = {**paired_delta(results['B1'], results['B5']), 'bootstrap': bootstrap_delta(results['B1'], results['B5'])}
    if 'B4' in results and 'B5' in results:
        report['pairedDeltas']['B5_minus_B4'] = {**paired_delta(results['B4'], results['B5']), 'bootstrap': bootstrap_delta(results['B4'], results['B5'])}
    output = Path(args.output_dir); output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    (output / f'metadata_intelligence_{stamp}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / f'metadata_intelligence_artifacts_{stamp}.json').write_text(json.dumps(artifacts, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__': main()
