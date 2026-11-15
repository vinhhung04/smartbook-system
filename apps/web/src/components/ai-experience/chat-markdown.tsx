import type { MouseEvent, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { parseBlocks, type Block, type Inline, type RecordKind } from '@/lib/chat-markdown';

// Renders an AI chat answer. Record codes link to the record when `records` is
// given; same-site links navigate in place; other links open a new tab.

export interface RecordLinks {
  /** Where the code points without a lookup (the list page); also the link's href. */
  href: (kind: RecordKind) => string;
  /** Opens the record itself, falling back to the list. */
  open: (kind: RecordKind, code: string) => void;
}

interface Props {
  text: string;
  /** Shows a text caret after the last character while the answer is being written. */
  caret?: boolean;
  records?: RecordLinks;
  onNavigate?: (href: string) => void;
}

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function Runs({ runs, records, onNavigate }: { runs: Inline[]; records?: RecordLinks; onNavigate?: (href: string) => void }) {
  return (
    <>
      {runs.map((run, i) => {
        switch (run.type) {
          case 'text':
            return <span key={i}>{run.text}</span>;
          case 'bold':
            return <strong key={i} className="font-semibold"><Runs runs={run.children} records={records} onNavigate={onNavigate} /></strong>;
          case 'code':
            return <code key={i} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">{run.text}</code>;
          case 'record':
            return records ? (
              <a key={i} href={records.href(run.kind)} className="font-medium text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary active:text-primary/80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring whitespace-nowrap font-mono text-[13px]"
                title={run.kind === 'loan' ? 'Mở phiếu mượn' : 'Mở danh sách đặt trước'}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  records.open(run.kind, run.code);
                }}>
                {run.code}
              </a>
            ) : (
              <span key={i} className="font-mono text-[13px]">{run.code}</span>
            );
          case 'link':
            return run.external ? (
              <a key={i} href={run.href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary active:text-primary/80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">
                {run.label === run.href ? run.href.replace(/^https?:\/\//i, '') : run.label}
                <ArrowUpRight className="ml-0.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
                <span className="sr-only"> (mở thẻ mới)</span>
              </a>
            ) : (
              <a key={i} href={run.href} className="font-medium text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary active:text-primary/80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                onClick={(event) => {
                  if (!onNavigate || !plainClick(event)) return;
                  event.preventDefault();
                  onNavigate(run.href);
                }}>
                {run.label}
              </a>
            );
        }
      })}
    </>
  );
}

const Caret = () => (
  <span aria-hidden="true" className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
);

function BlockView({ block, tail, records, onNavigate }: { block: Block; tail: ReactNode; records?: RecordLinks; onNavigate?: (href: string) => void }) {
  const runs = (inline: Inline[]) => <Runs runs={inline} records={records} onNavigate={onNavigate} />;
  switch (block.type) {
    case 'heading':
      return <p className={block.level === 1 ? 'mt-1 text-[15px] font-semibold leading-6' : 'mt-1 text-[14px] font-semibold leading-6'}>{runs(block.inline)}{tail}</p>;
    case 'paragraph':
      return <p>{runs(block.inline)}{tail}</p>;
    case 'gap':
      return <span className="block h-1.5" aria-hidden="true" />;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={block.ordered ? 'ml-5 list-decimal space-y-1 marker:text-muted-foreground' : 'ml-5 list-disc space-y-1 marker:text-muted-foreground'}>
          {block.items.map((item, i) => (
            <li key={i} className="pl-0.5">{runs(item)}{i === block.items.length - 1 ? tail : null}</li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <>
          <div className="my-1 overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-left text-[13px] leading-5 tabular-nums">
              <thead>
                <tr>
                  {block.head.map((cell, i) => (
                    <th key={i} scope="col" className="whitespace-nowrap bg-muted/60 px-3 py-2 font-medium text-muted-foreground">{runs(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className="border-t border-border px-3 py-2 align-top">{runs(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tail}
        </>
      );
  }
}

export function ChatMarkdown({ text, caret = false, records, onNavigate }: Props) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-1.5 break-words text-[14px] leading-6">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} records={records} onNavigate={onNavigate}
          tail={caret && i === blocks.length - 1 ? <Caret /> : null} />
      ))}
      {caret && blocks.length === 0 && <Caret />}
    </div>
  );
}
