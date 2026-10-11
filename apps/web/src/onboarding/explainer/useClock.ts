/** Player clock and the live reduced-motion preference (ONBOARDING.md §5.1, §7). */
import { useCallback, useEffect, useRef, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** `prefers-reduced-motion: reduce`, re-read when the setting changes (not only at load). */
export function useReducedMotion(): boolean {
  const get = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(QUERY).matches;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const frame = (cb: (now: number) => void): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(performance.now()), 16) as unknown as number);
const cancel = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id);

/**
 * A seconds clock from 0 to `total`. It advances only while `playing`; reaching the end stops it and calls
 * `onEnd` once. `seek` jumps anywhere (scrub, chapter buttons) and keeps the play state.
 */
export function useClock(total: number, playing: boolean, onEnd: () => void) {
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    if (!playing) return undefined;
    let id = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const next = Math.min(total, tRef.current + dt);
      tRef.current = next;
      setT(next);
      if (next >= total) {
        endRef.current();
        return;
      }
      id = frame(tick);
    };
    id = frame(tick);
    return () => cancel(id);
  }, [playing, total]);

  const seek = useCallback(
    (to: number) => {
      const v = Math.max(0, Math.min(total, to));
      tRef.current = v;
      setT(v);
    },
    [total],
  );
  return { t, seek };
}
