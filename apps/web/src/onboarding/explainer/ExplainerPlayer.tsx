/**
 * The in-app explainer (ONBOARDING.md §5): React + SVG motion graphics, captions only (no audio track, so no
 * mute). Play/Pause (Space or K), previous/next chapter (← →), a chapter list, a time slider, captions on/off,
 * a full transcript, Skip. It never starts by itself: `autoPlay` is passed only after the person pressed
 * "Play the 90-second tour". With `prefers-reduced-motion: reduce` it shows a still storyboard with the text.
 */
import type { GuidePath } from '@growth-os/contracts';
import { Icon } from '@growth-os/ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Stage } from './scenes';
import {
  captionAt,
  CHAPTER_STARTS,
  CHAPTERS,
  clock,
  locate,
  ROLE_ENDINGS,
  TOTAL_SECONDS,
  transcript,
} from './script';
import { useClock, useReducedMotion } from './useClock';

export interface ExplainerPlayerProps {
  path: GuidePath;
  name: string;
  initials: string;
  /** Start playing on mount (only after a user gesture). */
  autoPlay?: boolean;
  /** Reached the end (record "completed"). */
  onFinished: () => void;
  /** "Skip tour" (record "skipped" unless already finished). */
  onSkip: () => void;
  /** Close after the end, optionally following the role call to action. */
  onDone: (href?: string) => void;
  /** Test hook: force the reduced-motion storyboard. */
  forceReducedMotion?: boolean;
}

function isControl(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && ['BUTTON', 'INPUT', 'A', 'SELECT', 'TEXTAREA'].includes(e.tagName);
}

export function ExplainerPlayer({
  path,
  name,
  initials,
  autoPlay = false,
  onFinished,
  onSkip,
  onDone,
  forceReducedMotion,
}: ExplainerPlayerProps) {
  const prefersReduced = useReducedMotion();
  const reduced = forceReducedMotion ?? prefersReduced;
  const [playing, setPlaying] = useState(autoPlay && !reduced);
  const [ended, setEnded] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [boardIndex, setBoardIndex] = useState(0);
  const finishedRef = useRef(false);
  const playRef = useRef<HTMLButtonElement>(null);
  const transcriptId = useId();
  const sliderId = useId();

  const finish = () => {
    setPlaying(false);
    setEnded(true);
    if (!finishedRef.current) {
      finishedRef.current = true;
      onFinished();
    }
  };
  const { t, seek } = useClock(TOTAL_SECONDS, playing, finish);
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  const { index, local } = reduced ? { index: boardIndex, local: CHAPTERS[boardIndex]!.duration } : locate(t);
  const caption = captionAt(index, reduced ? 0 : local, path);
  const ending = ROLE_ENDINGS[path];
  const atEnd = reduced ? boardIndex === CHAPTERS.length - 1 : ended || index === CHAPTERS.length - 1;

  const goChapter = (i: number) => {
    const next = Math.max(0, Math.min(CHAPTERS.length - 1, i));
    if (reduced) {
      setBoardIndex(next);
      if (next === CHAPTERS.length - 1 && !finishedRef.current) {
        finishedRef.current = true;
        onFinished(); // the storyboard was read to the end
      }
      return;
    }
    setEnded(false);
    seek(CHAPTER_STARTS[next]!);
  };
  const toggle = () => {
    if (reduced) return;
    if (ended || t >= TOTAL_SECONDS) {
      setEnded(false);
      seek(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === ' ' || e.key.toLowerCase() === 'k') && !isControl(e.target)) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowRight' && (e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
      goChapter(index + 1);
    } else if (e.key === 'ArrowLeft' && (e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
      goChapter(index - 1);
    }
  };

  const fullCaption = (i: number) => transcript(path)[i]!.lines.filter(Boolean).join(' ');
  const stageLabel = `${CHAPTERS[index]!.title}. ${reduced ? fullCaption(index) : caption}`;

  return (
    // The keydown handler adds shortcuts on top of the native controls inside; it is not a control itself.
    <div className="onb-player" onKeyDown={onKeyDown}>
      <div className="onb-player__head">
        <div>
          <h2 id="onb-player-title" className="onb-player__title">
            How Market Expansion works
          </h2>
          <p className="onb-player__sub">
            {reduced ? 'Storyboard · reduced motion' : `${clock(TOTAL_SECONDS)} · 8 chapters`} · Captions only
            — no sound · Illustrative data
          </p>
        </div>
        <button type="button" className="gos-btn gos-btn--ghost" onClick={onSkip}>
          {ended || finishedRef.current ? 'Close' : 'Skip tour'}
        </button>
      </div>

      <div className="onb-player__stage" data-testid="explainer-stage" data-chapter={CHAPTERS[index]!.id}>
        <Stage index={index} s={local} path={path} name={name} initials={initials} label={stageLabel} />
      </div>

      {reduced ? (
        <div className="onb-player__board-text">
          <h3>{`${index + 1}. ${CHAPTERS[index]!.title}`}</h3>
          {transcript(path)[index]!.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      ) : captions ? (
        <p className="onb-player__caption" data-testid="explainer-caption">
          {caption}
        </p>
      ) : (
        <p className="onb-player__caption onb-player__caption--off">Captions off</p>
      )}

      <div className="onb-player__controls" role="group" aria-label="Tour controls">
        {reduced ? null : (
          <button
            ref={playRef}
            type="button"
            className="gos-btn gos-btn--secondary"
            onClick={toggle}
            aria-keyshortcuts="Space K"
          >
            {playing ? (
              <Icon name="pause" size={15} />
            ) : (
              <svg width={15} height={15} viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5z" style={{ fill: 'currentColor' }} />
              </svg>
            )}
            {playing ? 'Pause' : ended ? 'Play again' : t > 0 ? 'Resume' : 'Play'}
          </button>
        )}
        <button
          type="button"
          className="gos-ibtn"
          aria-label="Previous chapter"
          aria-keyshortcuts="ArrowLeft"
          onClick={() => goChapter(index - 1)}
          disabled={index === 0}
        >
          <Icon name="chevl" size={16} />
        </button>
        <button
          type="button"
          className="gos-ibtn"
          aria-label="Next chapter"
          aria-keyshortcuts="ArrowRight"
          onClick={() => goChapter(index + 1)}
          disabled={index === CHAPTERS.length - 1}
        >
          <Icon name="chevr" size={16} />
        </button>
        {reduced ? (
          <span className="onb-player__time">{`Chapter ${index + 1} of ${CHAPTERS.length}`}</span>
        ) : (
          <>
            <label htmlFor={sliderId} className="gos-sr-only">
              Tour position
            </label>
            <input
              id={sliderId}
              type="range"
              className="onb-player__slider"
              min={0}
              max={TOTAL_SECONDS}
              step={0.5}
              value={Math.round(t * 2) / 2}
              aria-valuetext={`${clock(t)} of ${clock(TOTAL_SECONDS)} · Chapter ${index + 1} of ${CHAPTERS.length}: ${CHAPTERS[index]!.title}`}
              onChange={(e) => {
                setEnded(false);
                seek(Number(e.target.value));
              }}
            />
            <span className="onb-player__time" aria-hidden="true">
              {`${clock(t)} / ${clock(TOTAL_SECONDS)}`}
            </span>
            <button
              type="button"
              className="gos-btn gos-btn--ghost"
              aria-pressed={captions}
              onClick={() => setCaptions((c) => !c)}
            >
              Captions
            </button>
          </>
        )}
        <button
          type="button"
          className="gos-btn gos-btn--ghost"
          aria-expanded={showTranscript}
          aria-controls={transcriptId}
          onClick={() => setShowTranscript((v) => !v)}
        >
          Transcript
        </button>
      </div>

      <nav aria-label="Tour chapters">
        <ol className="onb-player__chapters">
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className="onb-player__chapter"
                aria-current={i === index ? 'step' : undefined}
                onClick={() => goChapter(i)}
              >
                <span className="onb-player__chapter-n">{i + 1}</span>
                {c.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {atEnd ? (
        <div className="onb-player__end">
          <p>{ending.line}</p>
          <button type="button" className="gos-btn gos-btn--primary" onClick={() => onDone(ending.href)}>
            {ending.cta}
          </button>
          <button type="button" className="gos-btn gos-btn--ghost" onClick={() => onDone()}>
            Close the tour
          </button>
        </div>
      ) : null}

      <div id={transcriptId} hidden={!showTranscript} className="onb-player__transcript">
        <h3>Transcript</h3>
        {transcript(path).map((c, i) => (
          <section key={c.title} aria-label={`Chapter ${i + 1}: ${c.title}`}>
            <h4>{`${i + 1}. ${c.title}`}</h4>
            {c.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
