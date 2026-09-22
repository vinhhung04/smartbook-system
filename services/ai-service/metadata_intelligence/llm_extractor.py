import asyncio
import json
import time
from pathlib import Path

from .evidence_validation import extract_llm_candidates

PROMPT = Path(__file__).with_name('prompts').joinpath('extract_v1.txt').read_text(encoding='utf-8')
CHUNK_CHARS = 12000


def chunks(doc):
    batches, current, size = [], [], 0
    for block in doc['blocks']:
        if len(block['text']) > CHUNK_CHARS:
            # Retain original block coordinates; an overlong block is clipped, never silently fabricated.
            block = {**block, 'text': block['text'][:CHUNK_CHARS]}
        if current and size + len(block['text']) > CHUNK_CHARS:
            batches.append(current)
            current, size = [], 0
        current.append(block)
        size += len(block['text'])
    if current:
        batches.append(current)
    return batches[:2], len(batches) > 2 or any(len(b['text']) > CHUNK_CHARS for b in doc['blocks'])


def parse_response(text):
    data = json.loads(text)
    if not isinstance(data, dict) or not isinstance(data.get('fields'), dict):
        raise ValueError('Expected fields object')
    for field, item in data['fields'].items():
        if not isinstance(item, dict) or not isinstance(item.get('evidence', []), list):
            raise ValueError('Invalid field entry: ' + field)
    return data


async def extract(doc, provider, deadline):
    candidates, evidence, calls, warnings = [], [], [], []
    batches, truncated = chunks(doc)
    if truncated:
        warnings.append('TEXT_WINDOW_TRUNCATED:' + doc['id'])
    for index, blocks in enumerate(batches):
        messages = [{'role': 'system', 'content': PROMPT},
                    {'role': 'user', 'content': json.dumps({'blocks': blocks}, ensure_ascii=False)}]
        for attempt in range(2):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                warnings.append('BUDGET_EXHAUSTED')
                return candidates, evidence, calls, warnings
            started = time.monotonic()
            call = {'documentId': doc['id'], 'chunk': index, 'attempt': attempt,
                    'model': provider.model, 'promptVersion': 'extract-v1', 'costUsd': None}
            try:
                result = await asyncio.wait_for(provider.chat(messages, [], num_predict=2600,
                                               timeout=min(remaining, 20), temperature=0), timeout=min(remaining, 20))
                call.update(result.usage.as_dict())
                call['rawResponse'] = result.text
                parsed = parse_response(result.text)
                cs, es = extract_llm_candidates(doc, parsed, result.usage.model)
                candidates.extend(cs)
                evidence.extend(es)
                call['status'] = 'OK'
                calls.append(call)
                break
            except (json.JSONDecodeError, ValueError) as exc:
                call.update(status='INVALID_JSON', error=type(exc).__name__)
                messages.append({'role': 'user', 'content': 'Invalid JSON/schema. Return ONLY the requested JSON object, grounded in the same source blocks.'})
            except Exception as exc:
                call.update(status='ERROR', error=type(exc).__name__)
                warnings.append('LLM_UNAVAILABLE:' + doc['id'])
                calls.append(call)
                break
            finally:
                call['elapsedMs'] = round((time.monotonic() - started) * 1000)
            calls.append(call)
    return candidates, evidence, calls, warnings
