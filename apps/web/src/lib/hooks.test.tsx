// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from './api-client';
import { useDraft, type Versioned } from './drafts';
import { bodyFingerprint, isRetryable, useIntent, withSameKey } from './idempotency';

const problem = (code: 'VERSION_CONFLICT' | 'INTERNAL' | 'VALIDATION_FAILED', status: number) =>
  new ApiProblem({ type: 'about:blank', title: code, status, code, correlationId: 't' });

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('idempotency', () => {
  it('retries transient failures with the same key and never retries 4xx', async () => {
    const keys: string[] = [];
    let n = 0;
    const out = await withSameKey(
      'k-1',
      async (k) => {
        keys.push(k);
        if (n++ < 2) throw problem('INTERNAL', 500);
        return 'ok';
      },
      { baseDelayMs: 1 },
    );
    expect(out).toBe('ok');
    expect(keys).toEqual(['k-1', 'k-1', 'k-1']);
    expect(isRetryable(problem('VALIDATION_FAILED', 400))).toBe(false);
    expect(isRetryable(new TypeError('network'))).toBe(true);
  });

  it('fingerprints bodies independent of key order', () => {
    expect(bodyFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(bodyFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('one key per intent: reused after a failure, new after success or a changed body', async () => {
    const { result } = renderHook(() => useIntent({ retries: 0 }));
    const seen: string[] = [];
    await act(async () => {
      await result.current
        .run({ x: 1 }, async (k) => {
          seen.push(k);
          throw problem('INTERNAL', 500);
        })
        .catch(() => {});
    });
    await act(async () => {
      await result.current.run({ x: 1 }, async (k) => void seen.push(k));
    });
    await act(async () => {
      await result.current.run({ x: 1 }, async (k) => void seen.push(k));
    });
    await act(async () => {
      await result.current.run({ x: 2 }, async (k) => void seen.push(k));
    });
    expect(seen[0]).toBe(seen[1]); // "Try again" reuses the key
    expect(seen[2]).not.toBe(seen[1]); // a new click after success is a new intent
    expect(seen[3]).not.toBe(seen[2]);
  });

  it('a double click while pending sends one request', async () => {
    const { result } = renderHook(() => useIntent());
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 1;
    });
    await act(async () => {
      await Promise.all([result.current.run({}, fn), result.current.run({}, fn)]);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('useDraft', () => {
  type F = { title: string };
  const server: Versioned<F> = { value: { title: 'v1' }, rowVersion: 3 };

  it('debounces, sends If-Match row version and reports Saved', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (v: F, rv: number) => ({ value: v, rowVersion: rv + 1 }));
    const { result } = renderHook(() =>
      useDraft<F>({ storageKey: 't:mandate:2', server, save, debounceMs: 800 }),
    );
    expect(result.current.value).toEqual({ title: 'v1' });
    act(() => result.current.setField('title', 'a'));
    act(() => result.current.setField('title', 'ab'));
    expect(sessionStorage.getItem('draft:t:mandate:2')).toContain('ab');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: 'ab' }, 3);
    expect(result.current.status.state).toBe('saved');
    expect(sessionStorage.getItem('draft:t:mandate:2')).toBeNull();
  });

  it('a 412 shows a conflict and never overwrites silently', async () => {
    const save = vi.fn(async () => {
      throw problem('VERSION_CONFLICT', 412);
    });
    const reload = vi.fn(async () => ({ value: { title: 'theirs' }, rowVersion: 5 }));
    const { result } = renderHook(() =>
      useDraft<F>({ storageKey: null, server, save, reload, debounceMs: 1 }),
    );
    act(() => result.current.setField('title', 'mine'));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status.state).toBe('conflict');
    expect(result.current.conflict?.mine).toEqual({ title: 'mine' });
    expect(result.current.conflict?.theirs?.value).toEqual({ title: 'theirs' });
    save.mockImplementation(async () => ({ value: { title: 'mine' }, rowVersion: 6 }) as never);
    await act(async () => {
      await result.current.resolveConflict('mine');
    });
    expect(save).toHaveBeenLastCalledWith({ title: 'mine' }, 5);
    expect(result.current.status.state).toBe('saved');
  });

  it('restores unsent edits after a reload', async () => {
    sessionStorage.setItem('draft:t:x:1', JSON.stringify({ baseRowVersion: 3, value: { title: 'unsent' } }));
    const save = vi.fn(async (v: F) => ({ value: v, rowVersion: 4 }));
    const { result } = renderHook(() => useDraft<F>({ storageKey: 't:x:1', server, save, debounceMs: 1 }));
    expect(result.current.value).toEqual({ title: 'unsent' });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ title: 'unsent' }, 3));
  });

  it('a failed save keeps the edit and offers retry', async () => {
    const save = vi.fn(async () => {
      throw problem('INTERNAL', 500);
    });
    const { result } = renderHook(() => useDraft<F>({ storageKey: null, server, save, debounceMs: 1 }));
    act(() => result.current.setField('title', 'x'));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status.state).toBe('unsaved');
    expect(result.current.value).toEqual({ title: 'x' });
  });
});
