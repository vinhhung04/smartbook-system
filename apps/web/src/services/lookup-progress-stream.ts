import { aiAPI, getToken } from './http-clients';
import type { IsbnLookupSource, IsbnSourceName, IsbnVerification } from './ai';

/**
 * Progress events of one ISBN lookup, sent by ai-service as the lookup runs
 * (services/ai-service/isbn_progress.py). They describe what really happened:
 * the UI never invents a step these events did not report.
 */
export type LookupStageName = 'validate' | 'cache' | 'retrieval' | 'round1' | 'round2' | 'fusion' | 'pipeline' | 'authority' | 'ai';

export interface LookupStageEvent {
  type: 'stage';
  seq: number;
  t: number;
  stage: LookupStageName;
  state: 'started' | 'done' | 'failed';
  detail?: Record<string, unknown>;
}

export interface LookupSourceEvent {
  type: 'source';
  seq: number;
  t: number;
  state: 'started' | 'done';
  source: IsbnSourceName;
  round: 1 | 2;
  query?: 'code' | 'title' | '-';
  status?: IsbnLookupSource['status'];
  durationMs?: number;
  attempts?: number;
  verification?: IsbnVerification;
  matchConfidence?: number;
  reason?: string;
  errorCode?: string;
  sourceUrl?: string;
}

export type LookupProgressEvent = LookupStageEvent | LookupSourceEvent;

/** The progress channel could not deliver a result (not deployed, refused, cut off):
 *  the caller falls back to the plain JSON endpoint. */
export class ProgressStreamUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ProgressStreamUnavailable';
  }
}

function parseBlock(block: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

/**
 * POST `path` on ai-service (through the API Gateway, with the user's token) and
 * read its SSE body: `progress` events go to `onProgress`, the single `result`
 * event resolves. fetch() instead of EventSource because the request needs a
 * body and an Authorization header - the same reason as askAssistantStream.
 */
export async function postWithProgress<T>(
  path: string,
  body: unknown,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (event: LookupProgressEvent) => void },
): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`${aiAPI.defaults.baseURL || ''}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProgressStreamUnavailable('network');
  }
  if (!response.ok || !response.body || !(response.headers.get('content-type') || '').includes('text/event-stream')) {
    throw new ProgressStreamUnavailable(`http-${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ProgressStreamUnavailable('interrupted');
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const message = parseBlock(block);
        if (!message) continue;
        if (message.event === 'progress') {
          try {
            onProgress(JSON.parse(message.data) as LookupProgressEvent);
          } catch {
            // A malformed progress line only loses that one step, never the result.
          }
        } else if (message.event === 'result') {
          return JSON.parse(message.data) as T;
        } else if (message.event === 'error') {
          throw new ProgressStreamUnavailable('server-error');
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new ProgressStreamUnavailable('ended-without-result');
}
