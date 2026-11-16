// Parses the small markdown subset the AI chat answers use into blocks and
// inline runs, so the chat can render them without an HTML parser. Record
// codes (LOAN-…, RSV-…) become their own runs so the UI can link them.

export type RecordKind = 'loan' | 'reservation';

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; label: string; external: boolean }
  | { type: 'record'; kind: RecordKind; code: string };

export type Block =
  | { type: 'heading'; level: 1 | 2; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'gap' };

const INLINE = /\*\*(.+?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(?<![A-Za-z0-9-])(?:[A-Z]{2,8}-)?(LOAN|RSV)-[A-Z0-9]+(?:-[A-Z0-9]+)?\b|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

/** Only same-site paths and http(s) URLs become links; anything else (javascript:, data:) stays text. */
export function safeHref(href: string): { href: string; external: boolean } | null {
  if (/^\/(?!\/)/.test(href)) return { href, external: false };
  if (/^https?:\/\//i.test(href)) return { href, external: true };
  return null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev?.type === 'text') prev.text += value;
    else out.push({ type: 'text', text: value });
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    pushText(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) out.push({ type: 'bold', children: parseInline(m[1]) });
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] });
    else if (m[3] !== undefined) {
      const safe = safeHref(m[4]);
      if (safe) out.push({ type: 'link', label: m[3], ...safe });
      else pushText(m[3]);
    } else if (m[5] !== undefined) out.push({ type: 'record', kind: m[5] === 'LOAN' ? 'loan' : 'reservation', code: m[0] });
    else if (m[6] !== undefined) out.push({ type: 'link', href: m[6], label: m[6], external: true });
  }
  pushText(text.slice(last));
  return out;
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length === 1 ? 1 : 2, inline: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    // A table needs its rule line; while the rule is still streaming in, the header reads as text.
    if (line.trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = tableCells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(tableCells(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !bullet;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = ordered ? lines[i].match(/^\s*\d+[.)]\s+(.*)$/) : lines[i].match(/^\s*[-*]\s+(.*)$/);
        if (!m) break;
        items.push(parseInline(m[1]));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (line.trim() === '') {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'gap') blocks.push({ type: 'gap' });
      i += 1;
      continue;
    }

    blocks.push({ type: 'paragraph', inline: parseInline(line) });
    i += 1;
  }
  while (blocks[blocks.length - 1]?.type === 'gap') blocks.pop();
  return blocks;
}
