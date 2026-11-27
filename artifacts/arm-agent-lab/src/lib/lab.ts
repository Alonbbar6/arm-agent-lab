import type { Scene } from '@workspace/arm-sim';

export type LabMode = 'mock' | 'claude';
export type TerminalStatus = 'done' | 'refused' | 'failed';

export type LabEvent = {
  seq: number;
  type: 'note' | 'tool_call' | 'tool_result' | 'safety_rejection' | 'scene' | 'finished';
  time: number;
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  scene?: Scene;
  durationMs?: number;
  status?: TerminalStatus;
  summary?: string;
  mode: LabMode;
};

export function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}api/lab/${path.replace(/^\//, '')}`;
}

export function errorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const anyErr = err as Error & { data?: unknown; status?: number };
    const data = anyErr.data as { error?: string; message?: string } | undefined;
    const detail = data?.error ?? data?.message;
    return detail ? `${detail}${anyErr.status ? ` (HTTP ${anyErr.status})` : ''}` : anyErr.message;
  }
  return String(err);
}

export const MISSING_KEY_BANNER =
  'Mock planner: add ANTHROPIC_API_KEY in Replit Secrets to drive the arm with Claude.';

export const EXAMPLES: { label: string; text: string; unsafe?: boolean }[] = [
  { label: 'Stack red on blue', text: 'stack red on blue' },
  { label: 'Put green in slot 3', text: 'put green in slot 3' },
  { label: 'Unstack', text: 'unstack' },
  { label: 'Return home', text: 'put everything back home' },
  { label: 'Into red zone', text: 'Put the blue block inside the red keep-out zone.', unsafe: true },
  { label: 'Lift heavy block', text: 'stack heavy on red', unsafe: true },
];
