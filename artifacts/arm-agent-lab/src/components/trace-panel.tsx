import { useEffect, useRef } from 'react';
import type { LabEvent, TerminalStatus } from '@/lib/lab';

const TAG: Record<LabEvent['type'], [string, string]> = {
  note: ['NOTE', 'text-muted-foreground'],
  tool_call: ['CALL', 'text-chart-4'],
  tool_result: ['RESULT', 'text-chart-2'],
  safety_rejection: ['SAFETY', 'text-destructive'],
  scene: ['SCENE', 'text-muted-foreground/70'],
  finished: ['END', 'text-primary'],
};

function json(v: unknown) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function TracePanel({ events, terminal }: { events: LabEvent[]; terminal: { status: TerminalStatus; summary?: string } | null }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [events.length]);

  if (!events.length)
    return (
      <div className="flex-1 grid place-items-center p-8 text-center">
        <div className="max-w-[260px] space-y-2">
          <div className="mx-auto h-px w-16 bg-border" />
          <p className="text-sm">No run yet.</p>
          <p className="text-xs text-muted-foreground">Public planner notes, tool calls with JSON args, results and safety rejections stream here.</p>
        </div>
      </div>
    );

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 font-mono text-[11.5px] leading-relaxed" aria-live="polite" data-testid="list-trace">
      {events.map((e) => {
        const [tag, cls] = TAG[e.type];
        return (
          <div key={e.seq} className={`lab-in grid grid-cols-[34px_52px_1fr] gap-1.5 rounded px-2 py-1 hover:bg-secondary/60 ${e.type === 'safety_rejection' ? 'bg-destructive/10' : ''}`} data-testid={`row-trace-${e.seq}`}>
            <span className="text-muted-foreground/60 tabular">{String(e.seq).padStart(3, '0')}</span>
            <span className={`font-semibold ${cls}`}>{tag}</span>
            <span className="min-w-0 break-words">
              {e.type === 'tool_call' && <><span className="text-foreground font-semibold">{e.tool}</span><span className="text-muted-foreground">({json(e.args ?? {})})</span></>}
              {e.type === 'tool_result' && <><span className="text-muted-foreground">{e.tool} {'->'} </span>{json(e.result)}</>}
              {e.type === 'scene' && <span className="text-muted-foreground">state update {e.durationMs ? `/ ${e.durationMs}ms` : ''}</span>}
              {e.type === 'finished' && <span>{e.status}{e.summary ? ` / ${e.summary}` : ''}</span>}
              {e.message && e.type !== 'finished' && <span className={e.type === 'tool_call' || e.type === 'tool_result' ? 'block text-muted-foreground' : ''}>{e.message}</span>}
            </span>
          </div>
        );
      })}
      {terminal?.summary && (
        <div className="m-2 rounded border-l-2 border-primary bg-secondary/50 px-3 py-2 font-sans text-xs">{terminal.summary}</div>
      )}
      <div ref={endRef} />
    </div>
  );
}
