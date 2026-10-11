/**
 * Test-only HTMLMediaElement stand-in for jsdom (which does not implement media playback): play/pause flip a
 * `paused` flag, `currentTime` is stored, `duration` defaults to 60 s, and every call is logged so tests can
 * assert what the tour asked the browser to do. Install in `beforeEach`, restore in `afterEach`.
 */
type Call = { el: HTMLMediaElement; op: 'play' | 'pause' | 'seek'; at?: number };

export function installMediaMock(defaultDuration = 60) {
  const state = new WeakMap<HTMLMediaElement, { paused: boolean; time: number; duration: number }>();
  const calls: Call[] = [];
  const get = (el: HTMLMediaElement) => {
    let s = state.get(el);
    if (!s) {
      s = { paused: true, time: 0, duration: defaultDuration };
      state.set(el, s);
    }
    return s;
  };
  const proto = HTMLMediaElement.prototype;
  const saved = (['play', 'pause', 'load', 'paused', 'currentTime', 'duration'] as const).map(
    (k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const,
  );
  Object.defineProperty(proto, 'play', {
    configurable: true,
    value(this: HTMLMediaElement) {
      get(this).paused = false;
      calls.push({ el: this, op: 'play', at: get(this).time });
      return Promise.resolve();
    },
  });
  Object.defineProperty(proto, 'pause', {
    configurable: true,
    value(this: HTMLMediaElement) {
      get(this).paused = true;
      calls.push({ el: this, op: 'pause' });
    },
  });
  Object.defineProperty(proto, 'load', { configurable: true, value() {} });
  Object.defineProperty(proto, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return get(this).paused;
    },
  });
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return get(this).time;
    },
    set(this: HTMLMediaElement, v: number) {
      get(this).time = v;
      calls.push({ el: this, op: 'seek', at: v });
    },
  });
  Object.defineProperty(proto, 'duration', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return get(this).duration;
    },
  });
  return {
    calls,
    setDuration: (el: HTMLMediaElement, d: number) => void (get(el).duration = d),
    playing: (root: ParentNode = document) =>
      Array.from(root.querySelectorAll('audio')).filter((a) => !a.paused),
    restore() {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(proto, k, d);
        else delete (proto as unknown as Record<string, unknown>)[k];
      }
    },
  };
}
