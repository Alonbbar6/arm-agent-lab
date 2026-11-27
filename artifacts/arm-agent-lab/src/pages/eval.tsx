import { useGetLabConfig, useRunLabEval, type EvalRow } from '@workspace/api-client-react';
import { useState } from 'react';
import { Check, Loader2, Play, X } from 'lucide-react';
import { ModeBanner } from '@/components/lab-bits';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/lab';
import { useLabMode } from '@/hooks/use-lab-mode';

export default function EvalPage() {
  const config = useGetLabConfig();
  const evalRun = useRunLabEval();
  const [mode, setMode] = useLabMode(config.data?.claudeAvailable ?? false);
  const [unguarded, setUnguarded] = useState(false);
  const evalMode = unguarded ? 'unguarded' : mode;
  const claude = config.data?.claudeAvailable ?? false;
  const report = evalRun.data;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-6 space-y-5">
      {config.data && !claude && <ModeBanner />}
      <header className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evaluation suite</h1>
          <p className="text-sm text-muted-foreground">{unguarded
            ? '6 unsafe actions attempted without planner policy checks. The simulator safety layer stays fully enabled.'
            : '16 tasks across scenarios: manipulation goals, unsafe requests that must be refused, and injected grasp faults.'}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Evaluation mode" className="flex flex-wrap gap-1">
            {(['mock', 'claude', 'unguarded'] as const).map(value => (
              <Button key={value} size="sm" role="radio" aria-checked={evalMode === value}
                variant={evalMode === value ? 'default' : 'outline'}
                disabled={evalRun.isPending || (value === 'claude' && !claude)}
                title={value === 'claude' ? config.data?.model : value === 'unguarded' ? 'No planner policy checks. Simulator safety remains enabled.' : 'Deterministic planner'}
                onClick={() => { setUnguarded(value === 'unguarded'); if (value !== 'unguarded') setMode(value); }}
                data-testid={`button-mode-${value}`}>
                {value === 'unguarded' ? 'Unguarded (safety test)' : value === 'claude' ? 'Claude' : 'Mock'}
              </Button>
            ))}
          </div>
          <Button onClick={() => evalRun.mutate({ data: { mode: evalMode } })} disabled={evalRun.isPending} data-testid="button-run-eval">
            {evalRun.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {evalRun.isPending ? `Running ${unguarded ? 6 : 16} tasks` : 'Run eval'}
          </Button>
        </div>
      </header>

      {evalRun.isError && (
        <div role="alert" className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" data-testid="text-eval-error">
          Eval failed: {errorMessage(evalRun.error)}
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => evalRun.mutate({ data: { mode: evalMode } })}>Retry</Button>
        </div>
      )}

      {evalRun.isPending && (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      )}

      {!report && !evalRun.isPending && (
        <div className="rounded-lg border border-dashed p-12 text-center lab-grid-bg">
          <p className="font-mono text-xs text-muted-foreground">NO REPORT</p>
          <p className="mt-2 text-sm">Run the suite to produce a live report. Nothing here is precomputed.</p>
        </div>
      )}

      {report && !evalRun.isPending && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={report.mode === 'unguarded' ? 'Safety layer block rate' : 'Success rate'} value={`${((report.mode === 'unguarded' ? report.safetyLayerBlockRate ?? 0 : report.successRate) * 100).toFixed(1)}%`} accent />
            <Stat label="Passed" value={`${report.passed} / ${report.total}`} />
            <Stat label="Mode" value={report.mode} />
            <Stat label="Generated" value={new Date(report.generatedAt).toLocaleTimeString()} />
          </div>
          {report.mode === 'unguarded' && <p className="text-sm text-muted-foreground">Unguarded mode bypassed planner checks, not simulator safety. Each pass required the expected rejection, an unchanged scene for that action, and zero executed violations.</p>}
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary origin-left transition-transform duration-700" style={{ transform: `scaleX(${report.total ? report.passed / report.total : 0})` }} />
          </div>
          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-eval">
              <thead className="text-[10px] font-mono uppercase text-muted-foreground border-b">
                <tr>{['', 'Task', 'Scenario', 'Expected', 'Status', 'Goal', 'Steps', 'Tools', 'Rejected', 'Violations', 'Retries', 'Time'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>{report.rows.map((r) => <Row key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold tabular ${accent ? 'text-primary' : ''}`} data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}>{value}</div>
    </div>
  );
}

function Row({ r }: { r: EvalRow }) {
  return (
    <tr className="border-b last:border-0 hover:bg-secondary/40 align-top" data-testid={`row-eval-${r.id}`}>
      <td className="px-3 py-2">{r.pass ? <Check className="size-4 text-chart-2" aria-label="pass" /> : <X className="size-4 text-destructive" aria-label="fail" />}</td>
      <td className="px-3 py-2 min-w-[260px]">
        <div className="font-mono text-[11px] text-muted-foreground">{r.id}</div>
        <div>{r.instruction}</div>
        {r.summary && <div className="text-xs text-muted-foreground mt-0.5">{r.summary}</div>}
        {r.mode === 'unguarded' && <div className="text-xs text-muted-foreground mt-0.5">{r.rejectionCode || 'No safety rejection'}. Rejected action unchanged: {r.rejectedActionUnchanged ? 'yes' : 'no'}.</div>}
      </td>
      <td className="px-3 py-2 font-mono text-xs">{r.scenario}</td>
      <td className="px-3 py-2 font-mono text-xs">{r.expected}</td>
      <td className={`px-3 py-2 font-mono text-xs ${r.status === 'done' ? 'text-chart-2' : r.status === 'refused' ? 'text-primary' : 'text-destructive'}`}>{r.status}</td>
      <td className="px-3 py-2 font-mono text-xs">{r.goalPassed ? 'met' : 'no'}</td>
      {[r.steps, r.toolCalls, r.safetyRejections, r.safetyViolations, r.graspRetries].map((n, i) => <td key={i} className="px-3 py-2 font-mono text-xs tabular">{n}</td>)}
      <td className="px-3 py-2 font-mono text-xs tabular whitespace-nowrap">{(r.timeMs / 1000).toFixed(2)}s</td>
    </tr>
  );
}
