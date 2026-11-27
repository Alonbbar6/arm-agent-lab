import { Bot, Cpu, KeyRound } from 'lucide-react';
import { MISSING_KEY_BANNER, type LabMode } from '@/lib/lab';

export function ModeBanner() {
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm" data-testid="banner-missing-key">
      <KeyRound className="size-4 text-primary shrink-0" />
      <span>{MISSING_KEY_BANNER}</span>
    </div>
  );
}

export function ModeSelector({
  mode, onChange, claudeAvailable, disabled, model,
}: { mode: LabMode; onChange: (m: LabMode) => void; claudeAvailable: boolean; disabled?: boolean; model?: string }) {
  const opts: { v: LabMode; label: string; Icon: typeof Bot; off: boolean }[] = [
    { v: 'mock', label: 'Mock', Icon: Cpu, off: false },
    { v: 'claude', label: 'Claude', Icon: Bot, off: !claudeAvailable },
  ];
  return (
    <div role="radiogroup" aria-label="Planner mode" className="inline-flex rounded-md border p-0.5 bg-background" title={mode === 'claude' && model ? model : undefined}>
      {opts.map(({ v, label, Icon, off }) => (
        <button
          key={v} type="button" role="radio" aria-checked={mode === v} disabled={disabled || off}
          onClick={() => onChange(v)}
          title={off ? 'ANTHROPIC_API_KEY not configured' : v === 'claude' ? model : 'Deterministic rule-based planner'}
          className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-mono transition-colors disabled:opacity-40 ${mode === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          data-testid={`button-mode-${v}`}
        >
          <Icon className="size-3" />{label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-[10px] font-mono text-muted-foreground">IDLE</span>;
  const cls: Record<string, string> = {
    done: 'border-chart-2/50 bg-chart-2/15 text-chart-2',
    refused: 'border-primary/50 bg-primary/15 text-primary',
    failed: 'border-destructive/50 bg-destructive/15 text-destructive',
    running: 'border-border text-foreground',
  };
  return (
    <span className={`lab-in inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider ${cls[status] ?? 'border-border'}`} data-testid={`badge-status-${status}`}>
      {status === 'running' && <span className="size-1.5 rounded-full bg-primary lab-pulse" />}
      {status}
    </span>
  );
}
