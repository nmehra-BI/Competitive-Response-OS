/**
 * Drafts and autosave (FRONTEND §6).
 *
 * - Field edits update local state immediately.
 * - A debounced save (800 ms after the last change, and on blur and route change via `flush`)
 *   sends a PATCH with `If-Match: "<rowVersion>"`.
 * - Status: "Saving…", "Saved · 2 min ago", "Unsaved changes — retry", "Changed elsewhere".
 * - Unsent edits are mirrored to sessionStorage keyed by tenant + resource + version, restored
 *   after a reload and cleared after a successful save.
 * - 412 VERSION_CONFLICT shows a conflict with mine vs theirs — never a silent overwrite.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AutosaveState } from '@growth-os/ui';
import { ApiProblem } from './api-client';

export interface Versioned<T> {
  value: T;
  rowVersion: number;
}

export interface UseDraftOptions<T> {
  /** `${tenantId}:${resource}:${version}`; null disables the sessionStorage mirror. */
  storageKey: string | null;
  /** Last server read. `undefined` while loading. */
  server: Versioned<T> | undefined;
  /** PATCH with If-Match = rowVersion. Resolves with the new server state. */
  save: (value: T, rowVersion: number) => Promise<Versioned<T>>;
  /** Re-read the server copy (used to show "theirs" after a conflict). */
  reload?: () => Promise<Versioned<T> | undefined>;
  debounceMs?: number;
  /** Clock for tests. */
  now?: () => Date;
}

export interface DraftConflict<T> {
  mine: T;
  theirs: Versioned<T> | null;
}

export interface Draft<T> {
  value: T | undefined;
  status: AutosaveState;
  dirty: boolean;
  set: (next: T | ((prev: T) => T)) => void;
  setField: <K extends keyof T>(key: K, v: T[K]) => void;
  /** Save now (blur, route change). */
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  conflict: DraftConflict<T> | null;
  /** Keep mine (re-applied on top of theirs' row version) or take theirs. */
  resolveConflict: (choice: 'mine' | 'theirs') => Promise<void>;
}

interface Stored<T> {
  baseRowVersion: number;
  value: T;
}

function readStore<T>(key: string | null): Stored<T> | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(`draft:${key}`);
    return raw ? (JSON.parse(raw) as Stored<T>) : null;
  } catch {
    return null;
  }
}
function writeStore<T>(key: string | null, v: Stored<T> | null) {
  if (!key) return;
  try {
    if (v) sessionStorage.setItem(`draft:${key}`, JSON.stringify(v));
    else sessionStorage.removeItem(`draft:${key}`);
  } catch {
    /* storage unavailable: autosave still works, only reload recovery is lost */
  }
}

export function useDraft<T>(opts: UseDraftOptions<T>): Draft<T> {
  const { storageKey, server, debounceMs = 800 } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const [value, setValue] = useState<T | undefined>(undefined);
  const [status, setStatus] = useState<AutosaveState>({ state: 'saved', at: new Date(0).toISOString() });
  const [conflict, setConflict] = useState<DraftConflict<T> | null>(null);
  const rowVersion = useRef<number | null>(null);
  const dirty = useRef(false);
  const latest = useRef<T | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const [, rerender] = useState(0);
  const now = () => (optsRef.current.now ?? (() => new Date()))();

  // Adopt server state when we have no local edits; restore unsent edits after a reload.
  useEffect(() => {
    if (!server) return;
    if (rowVersion.current === null) {
      const stored = readStore<T>(storageKey);
      rowVersion.current = server.rowVersion;
      if (stored && stored.baseRowVersion === server.rowVersion) {
        latest.current = stored.value;
        setValue(stored.value);
        dirty.current = true;
        setStatus({ state: 'unsaved' });
        schedule();
        return;
      }
      latest.current = server.value;
      setValue(server.value);
      setStatus({ state: 'saved', at: now().toISOString() });
      return;
    }
    if (!dirty.current && server.rowVersion !== rowVersion.current) {
      rowVersion.current = server.rowVersion;
      latest.current = server.value;
      setValue(server.value);
    }
  }, [server, storageKey]);

  const doSave = useCallback(async (): Promise<void> => {
    if (saving.current) {
      await saving.current;
    }
    if (!dirty.current || latest.current === undefined || rowVersion.current === null) return;
    const sending = latest.current;
    setStatus({ state: 'saving' });
    const p = (async () => {
      try {
        const res = await optsRef.current.save(sending, rowVersion.current!);
        rowVersion.current = res.rowVersion;
        if (latest.current === sending) {
          dirty.current = false;
          writeStore(optsRef.current.storageKey, null);
        } else {
          writeStore(optsRef.current.storageKey, {
            baseRowVersion: res.rowVersion,
            value: latest.current as T,
          });
        }
        setStatus({ state: 'saved', at: now().toISOString() });
      } catch (e) {
        if (e instanceof ApiProblem && e.code === 'VERSION_CONFLICT') {
          const theirs = (await optsRef.current.reload?.().catch(() => undefined)) ?? null;
          setConflict({ mine: latest.current as T, theirs });
          setStatus({ state: 'conflict' });
        } else {
          setStatus({ state: 'unsaved' });
        }
      }
    })();
    saving.current = p;
    try {
      await p;
    } finally {
      saving.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void doSave();
    }, optsRef.current.debounceMs ?? debounceMs);
  }, [doSave]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = latest.current as T;
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      latest.current = v;
      dirty.current = true;
      setValue(v);
      if (rowVersion.current !== null) {
        writeStore(optsRef.current.storageKey, { baseRowVersion: rowVersion.current, value: v });
      }
      if (!conflictRef.current) schedule();
      rerender((n) => n + 1);
    },
    [schedule],
  );
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;

  const setField = useCallback(
    <K extends keyof T>(key: K, v: T[K]) => set((p) => ({ ...p, [key]: v })),
    [set],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!conflictRef.current) await doSave();
  }, [doSave]);

  const resolveConflict = useCallback(
    async (choice: 'mine' | 'theirs') => {
      const c = conflictRef.current;
      if (!c) return;
      const theirs = c.theirs ?? (await optsRef.current.reload?.()) ?? null;
      setConflict(null);
      conflictRef.current = null;
      if (!theirs) return;
      rowVersion.current = theirs.rowVersion;
      if (choice === 'theirs') {
        latest.current = theirs.value;
        dirty.current = false;
        setValue(theirs.value);
        writeStore(optsRef.current.storageKey, null);
        setStatus({ state: 'saved', at: now().toISOString() });
      } else {
        latest.current = c.mine;
        dirty.current = true;
        await doSave();
      }
    },
    [doSave],
  );

  // Save on unmount (route change) and when the page is hidden.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  return {
    value,
    status,
    dirty: dirty.current,
    set,
    setField,
    flush,
    retry: flush,
    conflict,
    resolveConflict,
  };
}

// ---------------------------------------------------------------------------
// Publishing the save status to the shell header
// ---------------------------------------------------------------------------

type Publish = (s: AutosaveState | null) => void;
const AutosaveCtx = createContext<{ state: AutosaveState | null; publish: Publish }>({
  state: null,
  publish: () => {},
});

export function AutosaveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AutosaveState | null>(null);
  return createElement(AutosaveCtx.Provider, { value: { state, publish: setState } }, children);
}

/** The shell reads the status of the draft on screen. */
export function useAutosaveState(): AutosaveState | null {
  return useContext(AutosaveCtx).state;
}

/** A screen publishes its draft status so the header shows "Saving…" / "Saved · 2 min ago". */
export function usePublishAutosave(status: AutosaveState | null) {
  const { publish } = useContext(AutosaveCtx);
  const key = status ? JSON.stringify(status) : '';
  useEffect(() => {
    publish(status);
    return () => publish(null);
  }, [key, publish]);
}
