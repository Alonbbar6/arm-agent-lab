import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, type LabEvent } from '@/lib/lab';

export type StreamState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'lost';

export function useRunStream(onEvent: (e: LabEvent) => void) {
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [state, setState] = useState<StreamState>('idle');
  const esRef = useRef<EventSource | null>(null);
  const seen = useRef<Set<number>>(new Set());
  const cb = useRef(onEvent);
  cb.current = onEvent;

  const close = useCallback((next: StreamState = 'closed') => {
    esRef.current?.close();
    esRef.current = null;
    setState(next);
  }, []);

  const open = useCallback(
    (id: string) => {
      esRef.current?.close();
      seen.current = new Set();
      setEvents([]);
      setState('connecting');
      const es = new EventSource(apiUrl(`runs/${encodeURIComponent(id)}/events`));
      esRef.current = es;
      es.onopen = () => setState('open');
      es.onmessage = (msg) => {
        let ev: LabEvent;
        try {
          ev = JSON.parse(msg.data) as LabEvent;
        } catch {
          return;
        }
        if (seen.current.has(ev.seq)) return;
        seen.current.add(ev.seq);
        setEvents((prev) => [...prev, ev]);
        cb.current(ev);
        if (ev.type === 'finished') {
          es.close();
          if (esRef.current === es) esRef.current = null;
          setState('closed');
        }
      };
      es.onerror = () => {
        if (esRef.current !== es) return;
        if (es.readyState === EventSource.CLOSED) {
          esRef.current = null;
          setState('lost');
        } else setState('reconnecting');
      };
    },
    [],
  );

  useEffect(() => () => esRef.current?.close(), []);

  return { events, state, open, close };
}
