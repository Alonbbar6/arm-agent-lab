import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useCreateLabRun, useCreateLabScene, useGetLabConfig, useStopLabRun,
  type SceneSnapshot, type SceneInputScenario,
} from '@workspace/api-client-react';
import type { Scene } from '@workspace/arm-sim';
import { AlertTriangle, Play, RotateCcw, Square, ShieldAlert, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { ArmCanvas } from '@/components/arm-canvas';
import { ModeBanner, ModeSelector, StatusBadge } from '@/components/lab-bits';
import { TracePanel } from '@/components/trace-panel';
import { useRunStream, type StreamState } from '@/hooks/use-run-stream';
import { useLabMode } from '@/hooks/use-lab-mode';
import { EXAMPLES, errorMessage, type LabEvent, type LabMode, type TerminalStatus } from '@/lib/lab';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Laboratory() {
  const config = useGetLabConfig();
  const createScene = useCreateLabScene();
  const createRun = useCreateLabRun();
  const stopRun = useStopLabRun();

  const [scenario, setScenario] = useState('default');
  const [seed, setSeed] = useState(42);
  const [scene, setScene] = useState<Scene | null>(null);
  const [anim, setAnim] = useState({ dur: 0, key: 0 });
  const [instruction, setInstruction] = useState(EXAMPLES[0].text);
  const [mode, setMode] = useLabMode(config.data?.claudeAvailable ?? false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<LabMode | null>(null);
  const [terminal, setTerminal] = useState<{ status: TerminalStatus; summary?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const onEvent = useCallback((ev: LabEvent) => {
    if (ev.type === 'scene' && ev.scene) {
      setScene(ev.scene);
      setAnim((a) => ({ dur: ev.durationMs ?? 400, key: a.key + 1 }));
    }
    if (ev.type === 'finished') {
      setTerminal({ status: ev.status ?? 'failed', summary: ev.summary });
      if (ev.scene) { setScene(ev.scene); setAnim((a) => ({ dur: 300, key: a.key + 1 })); }
    }
  }, []);
  const stream = useRunStream(onEvent);
  const running = !!runId && !terminal;

  const claudeAvailable = config.data?.claudeAvailable ?? false;

  const sceneMutate = useRef(createScene.mutate);
  sceneMutate.current = createScene.mutate;
  const loadScene = useCallback((sc: string, sd: number) => {
    setError(null);
    sceneMutate.current(
      { data: { scenario: sc as SceneInputScenario, seed: sd } },
      {
        onSuccess: (snap) => {
          setScene(snap as unknown as Scene);
          setAnim((a) => ({ dur: 0, key: a.key + 1 }));
          setTerminal(null); setRunId(null); stream.close('idle');
        },
        onError: (e) => setError(`Could not create scene: ${errorMessage(e)}`),
      },
    );
  }, [stream.close]);
  useEffect(() => { loadScene('default', 42); }, [loadScene]);

  const run = () => {
    if (!scene || !instruction.trim()) return;
    setError(null); setTerminal(null);
    createRun.mutate(
      { data: { instruction: instruction.trim(), mode, scene: scene as unknown as SceneSnapshot } },
      {
        onSuccess: (h) => { setRunId(h.id); setRunMode(h.mode); stream.open(h.id); },
        onError: (e) => setError(`Run rejected: ${errorMessage(e)}`),
      },
    );
  };
  const stop = () => {
    if (!runId) return;
    stopRun.mutate({ id: runId }, { onError: (e) => setError(`Stop failed: ${errorMessage(e)}`) });
  };

  const locked = running || createRun.isPending || createScene.isPending || animating;
  const scenarios = config.data?.scenarios ?? ['default', 'scattered', 'keep-out', 'grasp-fault', 'stacked'];

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-5 md:px-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex flex-col gap-4 min-w-0">
        {config.isError && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" /> Config unavailable: {errorMessage(config.error)}
            <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => config.refetch()} data-testid="button-retry-config">Retry</Button>
          </div>
        )}
        {config.data && !claudeAvailable && <ModeBanner />}

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-xs font-mono text-muted-foreground">
            <span className="text-foreground font-semibold tracking-wide">WORKCELL / SIDE VIEW</span>
            <span>x horizontal / z vertical / meters</span>
            {scene && <span className="tabular">t={scene.simTime.toFixed(2)}s</span>}
            {scene && <span>held: <span className="text-foreground">{scene.arm.heldBlock ?? 'none'}</span></span>}
            {scene && scene.faultsRemaining > 0 && <span className="text-primary">faults armed: {scene.faultsRemaining}</span>}
            <span className="ml-auto flex items-center gap-1.5">
              {animating && <span className="size-1.5 rounded-full bg-primary lab-pulse" />}
              {animating ? 'moving' : 'settled'}
            </span>
          </div>
          <div className="p-2 md:p-3">
            {scene ? (
              <ArmCanvas scene={scene} durationMs={anim.dur} sceneKey={anim.key} onAnimating={setAnimating} />
            ) : createScene.isError ? (
              <div className="aspect-[1.24] grid place-items-center text-sm text-muted-foreground">
                <div className="text-center space-y-3">
                  <p>Scene could not be created.</p>
                  <Button size="sm" variant="outline" onClick={() => loadScene(scenario, seed)} data-testid="button-retry-scene">Retry</Button>
                </div>
              </div>
            ) : (
              <Skeleton className="w-full aspect-[1.24]" />
            )}
          </div>
          {scene && (
            <div className="flex flex-wrap gap-2 border-t px-4 py-2.5">
              {scene.blocks.map((b) => (
                <span key={b.id} className="font-mono text-[11px] rounded border px-2 py-0.5 text-muted-foreground tabular" data-testid={`text-block-${b.id}`}>
                  <span className="text-foreground font-semibold">{b.id}</span> x {b.x.toFixed(3)} z {b.z.toFixed(3)} m {b.mass.toFixed(2)}kg on {b.restsOn}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
          <label className="grid gap-1.5 text-xs font-mono text-muted-foreground">
            SCENARIO
            <Select value={scenario} onValueChange={(value) => { setScenario(value); loadScene(value, seed); }} disabled={locked}>
              <SelectTrigger data-testid="select-scenario" aria-label="Scenario"><SelectValue /></SelectTrigger>
              <SelectContent>
                {scenarios.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-mono text-muted-foreground">
            SEED
            <Input type="number" min={0} value={seed} disabled={locked} onChange={(e) => setSeed(Math.max(0, Number(e.target.value) || 0))} data-testid="input-seed" />
          </label>
          <Button variant="outline" disabled={locked || createScene.isPending} onClick={() => loadScene(scenario, seed)} data-testid="button-reset">
            {createScene.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Reset scene
          </Button>
        </div>
      </section>

      <aside className="flex flex-col gap-4 min-w-0">
        <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-mono font-semibold tracking-wide">INSTRUCTION</h2>
            <ModeSelector mode={mode} onChange={setMode} claudeAvailable={claudeAvailable} disabled={locked} model={config.data?.model} />
          </div>
          <Textarea
            value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={locked} maxLength={1000} rows={3}
            aria-label="Instruction for the agent" className="font-mono text-sm resize-none" data-testid="input-instruction"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex.label} type="button" disabled={locked} onClick={() => setInstruction(ex.text)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${ex.unsafe ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'hover:bg-secondary'} ${instruction === ex.text ? 'ring-1 ring-primary' : ''}`}
                data-testid={`chip-example-${i}`}
              >
                {ex.unsafe && <ShieldAlert className="size-3" />}{ex.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={locked || !scene || !instruction.trim()} onClick={run} data-testid="button-run">
              {createRun.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
            </Button>
            <Button variant="destructive" disabled={!running || stopRun.isPending} onClick={stop} data-testid="button-stop">
              <Square className="size-4" /> Stop
            </Button>
          </div>
          {error && <p role="alert" className="text-xs text-destructive font-mono" data-testid="text-error">{error}</p>}
        </div>

        <div className="rounded-lg border bg-card flex flex-col min-h-[420px] lg:max-h-[calc(100dvh-330px)]">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <h2 className="text-xs font-mono font-semibold tracking-wide">LIVE TRACE</h2>
            {runMode && <span className="text-[10px] font-mono uppercase rounded border px-1.5 py-0.5 text-muted-foreground">{runMode}</span>}
            <ConnState state={stream.state} />
            <span className="ml-auto"><StatusBadge status={terminal?.status ?? (running ? 'running' : null)} /></span>
          </div>
          {stream.state === 'lost' && !terminal && (
            <div role="alert" className="mx-4 mt-3 flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              Stream closed before the run finished.
              {runId && <Button size="sm" variant="outline" className="ml-auto h-6 text-xs" onClick={() => stream.open(runId)} data-testid="button-reconnect">Reconnect</Button>}
            </div>
          )}
          <TracePanel events={stream.events} terminal={terminal} />
        </div>
      </aside>
    </div>
  );
}

function ConnState({ state }: { state: StreamState }) {
  if (state === 'idle') return null;
  const map: Record<Exclude<StreamState, 'idle'>, [string, string]> = {
    connecting: ['connecting', 'text-muted-foreground'],
    open: ['live', 'text-chart-2'],
    reconnecting: ['reconnecting', 'text-primary'],
    closed: ['closed', 'text-muted-foreground'],
    lost: ['disconnected', 'text-destructive'],
  };
  const [label, cls] = map[state];
  const Icon = state === 'lost' ? WifiOff : Wifi;
  return (
    <span className={`flex items-center gap-1 text-[10px] font-mono uppercase ${cls}`} data-testid="status-connection">
      <Icon className={`size-3 ${state === 'reconnecting' || state === 'connecting' ? 'lab-pulse' : ''}`} />{label}
    </span>
  );
}
