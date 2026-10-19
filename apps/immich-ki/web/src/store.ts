import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImprintConfig } from '../../../web/src/types';
import { api, isBusy, type Job } from './api';

/*
 * Device-local storage. Drafts and the copied-settings clipboard live in this
 * browser only and are keyed by the authenticated panel owner, so they are
 * never shared across accounts.  Nothing here claims to be saved to Immich.
 */
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function draftStore(identity: string) {
  const prefix = `ki-draft-${identity || 'anonymous'}-`;
  return {
    read: (id: string): ImprintConfig | null => safe(() => { const raw = localStorage.getItem(prefix + id); return raw ? JSON.parse(raw) as ImprintConfig : null; }, null),
    write: (id: string, value: ImprintConfig) => safe(() => localStorage.setItem(prefix + id, JSON.stringify(value)), undefined),
    clear: (id: string) => safe(() => localStorage.removeItem(prefix + id), undefined),
    ids: (): Set<string> => safe(() => {
      const found = new Set<string>();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) found.add(key.slice(prefix.length));
      }
      return found;
    }, new Set<string>()),
  };
}
export type DraftStore = ReturnType<typeof draftStore>;

export function clipboardStore(identity: string) {
  const key = `ki-clip-${identity || 'anonymous'}`;
  return {
    read: (): { config: ImprintConfig; from: string } | null => safe(() => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }, null),
    write: (config: ImprintConfig, from: string) => safe(() => localStorage.setItem(key, JSON.stringify({ config, from })), undefined),
  };
}

/**
 * Tracks render jobs started or observed in this session and polls the busy
 * ones with backoff, so gallery badges and the editor status stay current
 * even after the user moves on to another photo.
 */
export function useJobTracker() {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const attempts = useRef<Record<string, number>>({});
  const track = useCallback((job: Job | null) => {
    if (!job) return;
    attempts.current[job.id] = 0;
    setJobs(all => ({ ...all, [job.asset_id]: job }));
  }, []);
  const busy = Object.values(jobs).filter(job => isBusy(job.state));
  const busyKey = busy.map(job => `${job.id}:${job.state}`).join(',');
  useEffect(() => {
    if (!busy.length) return;
    const control = new AbortController();
    // Fast while generating, slower while waiting for Immich to import; back off on repeated polls.
    const delay = Math.min(...busy.map(job => {
      const n = attempts.current[job.id] ?? 0;
      const base = ['awaiting_import', 'refresh_pending'].includes(job.state) ? 4000 : 1200;
      return Math.min(base * 1.5 ** Math.min(n, 5), 15000);
    }));
    const timer = setTimeout(() => {
      for (const job of busy) {
        attempts.current[job.id] = (attempts.current[job.id] ?? 0) + 1;
        api<Job>(`/jobs/${job.id}`, 'GET', undefined, control.signal)
          .then(next => setJobs(all => (all[next.asset_id]?.id === next.id ? { ...all, [next.asset_id]: next } : all)))
          .catch(() => { if (!control.signal.aborted) setJobs(all => ({ ...all })); });
      }
    }, delay);
    return () => { clearTimeout(timer); control.abort(); };
    // busyKey captures every state change that matters for scheduling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyKey, jobs]);
  return { jobs, track };
}
