import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImprintConfig } from '../../../web/src/types';
import { api, isBusy, type Activity, type ActivityJob } from './api';

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

/**
 * Device-local conveniences keyed by the panel owner: the copied-settings
 * clipboard and the last opened album. Drafts live on the server.
 */
export function localPrefs(identity: string) {
  const id = identity || 'anonymous';
  return {
    clipboard: {
      read: (): { config: ImprintConfig; from: string } | null => safe(() => { const raw = localStorage.getItem(`ki-clip-${id}`); return raw ? JSON.parse(raw) : null; }, null),
      write: (config: ImprintConfig, from: string) => safe(() => localStorage.setItem(`ki-clip-${id}`, JSON.stringify({ config, from })), undefined),
    },
    album: {
      read: (): string => safe(() => localStorage.getItem(`ki-album-${id}`) ?? '', ''),
      write: (album: string) => safe(() => localStorage.setItem(`ki-album-${id}`, album), undefined),
    },
  };
}

export type ActivityState = {
  /** Latest job per asset (unfinished, or finished within the last minutes). */
  jobs: Record<string, ActivityJob>;
  /** Photos accepted for a batch but not yet in the render queue. */
  waiting: number;
  refresh: () => void;
};

/**
 * Polls the album's activity with ONE request per tick (the per-job polling
 * it replaces cancelled its own requests and left badges stuck on busy).
 * Fast while anything is pending, slow otherwise; `refresh` polls now.
 */
export function useActivity(album: string, enabled: boolean): ActivityState {
  const [jobs, setJobs] = useState<Record<string, ActivityJob>>({});
  const [waiting, setWaiting] = useState(0);
  const [tick, setTick] = useState(0);
  const pending = useRef(false);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { setJobs({}); setWaiting(0); }, [album]);
  useEffect(() => {
    if (!enabled || !album) return;
    const control = new AbortController();
    let timer = 0;
    const poll = () => {
      api<Activity>(`/albums/${album}/activity`, 'GET', undefined, control.signal)
        .then(data => {
          const next: Record<string, ActivityJob> = {};
          for (const job of data.jobs) {
            const previous = next[job.assetId];
            if (!previous || (job.generation ?? -1) >= (previous.generation ?? -1)) next[job.assetId] = job;
          }
          setJobs(next);
          setWaiting(data.waiting);
          pending.current = data.waiting > 0 || data.jobs.some(job => isBusy(job.state));
        })
        .catch(() => { /* keep the last known state; retry on the next tick */ })
        .finally(() => {
          if (control.signal.aborted) return;
          timer = window.setTimeout(poll, pending.current ? 1500 : 15000);
        });
    };
    poll();
    return () => { control.abort(); clearTimeout(timer); };
  }, [album, enabled, tick]);
  return { jobs, waiting, refresh };
}
