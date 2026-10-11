#!/usr/bin/env python3
"""
Regenerate the onboarding tour audio (decisions.md D-200 onward; ONBOARDING.md "Audio").

  1. Voice: every caption cue of apps/web/src/onboarding/explainer/narration.json is spoken verbatim by a
     local neural TTS (Piper). A small pronunciation lexicon turns UI notation into speech for the engine
     only ("€100m/year" is spoken "100 million euros a year"); the caption text does not change.
  2. Timing: cues start no earlier than their scene's `designAt`, never overlap, and a chapter lasts at least
     its scene's `minDuration`; longer narration extends the chapter. Written to timing.json, which the
     player reads, so captions, visuals and audio share one clock.
  3. Music: an original ambient bed synthesized here (soft pads, slow pulse, no melody), ducked under
     speech and faded in and out. No samples, no third-party music.
  4. Encode: per-chapter voice files (the last chapter once per role path) and the music bed, each as
     Opus/WebM and AAC/M4A, into apps/web/public/onboarding/audio/. Optionally a full mix (WAV) for the MP4.

Requirements: Python 3 with numpy, ffmpeg on PATH, and Piper (`pip install piper-tts`) with a voice model.

  python3 scripts/onboarding-audio/generate.py \\
      --piper-python /path/to/venv/bin/python --model /path/en-us-libritts-high.onnx --speaker 0 \\
      [--mix-out /tmp/tour-mix-decide.wav --mix-path decide]

To use a professional recording instead (ONBOARDING.md §5.2): record one WAV per caption cue
(<chapterId>-<n>.wav, n from 1, and role-<path>.wav for the role lines) and pass --voice-dir instead of --model;
the timing, caption sync and music ducking then follow the recording.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NARRATION = os.path.join(ROOT, "apps/web/src/onboarding/explainer/narration.json")
TIMING = os.path.join(ROOT, "apps/web/src/onboarding/explainer/timing.json")
OUT_DIR = os.path.join(ROOT, "apps/web/public/onboarding/audio")
RATE = 44100
PATHS = ["build", "decide", "run", "review", "configure"]

LEAD_IN = 0.5  # seconds before the first cue of a chapter
GAP = 0.55  # seconds between cues
TAIL = 0.7  # seconds after the last cue
VOICE_RMS_DB = -19.0  # speech RMS (active parts) in dBFS
MUSIC_UNDER_SPEECH_DB = -21.0  # music below the voice while someone speaks
MUSIC_IN_GAPS_DB = -15.0  # music below the voice level in the pauses (ducking = 6 dB)


# ---------------------------------------------------------------------------
# Pronunciation lexicon (engine input only; captions stay as written)
# ---------------------------------------------------------------------------

def speakable(text: str) -> str:
    s = text
    s = re.sub(r"€(\d+(?:\.\d+)?)m/year", lambda m: f"{m.group(1)} million euros a year", s)
    s = re.sub(r"€(\d+(?:\.\d+)?)m\b", lambda m: f"{m.group(1)} million euros", s)
    s = re.sub(r"€(\d+)k\b", lambda m: f"{m.group(1)} thousand euros", s)
    s = re.sub(r"\bME-(\d+)", lambda m: "M E " + m.group(1), s)
    s = re.sub(r"\bPIL-(\d+)", lambda m: "P I L " + m.group(1), s)
    s = re.sub(r"\bG([0-3])\b", lambda m: "G " + ["zero", "one", "two", "three"][int(m.group(1))], s)
    s = s.replace("TAM", "Tam").replace("SAM", "Sam").replace("SOM", "Som")
    s = s.replace("AI draft", "A I draft").replace(" · ", ", ").replace("—", ",")
    s = s.replace("“", "").replace("”", "").replace("’", "'")
    s = s.replace("5,000", "5000").replace("2,000", "2000")
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def read_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return data.astype(np.float32) / 32768.0


def write_wav(path: str, x: np.ndarray, channels: int = 1) -> None:
    y = np.clip(x, -1.0, 1.0)
    pcm = (y * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def run(cmd: list[str], **kw) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **kw)


def trim_silence(x: np.ndarray, threshold: float = 0.004) -> np.ndarray:
    idx = np.where(np.abs(x) > threshold)[0]
    if idx.size == 0:
        return x[:0]
    pad = int(0.03 * RATE)
    return x[max(0, idx[0] - pad) : min(x.size, idx[-1] + pad)]


def synthesize(text: str, args, tmp: str, n: int) -> np.ndarray:
    raw = os.path.join(tmp, f"raw{n}.wav")
    res = os.path.join(tmp, f"res{n}.wav")
    subprocess.run(
        [args.piper_python, "-m", "piper", "-m", args.model, "-s", str(args.speaker),
         "--length-scale", str(args.length_scale), "--sentence-silence", "0.25", "-f", raw],
        input=speakable(text).encode(), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-ac", "1", "-ar", str(RATE), res])
    return trim_silence(read_wav(res))


def recorded(path: str, tmp: str, n: int) -> np.ndarray:
    res = os.path.join(tmp, f"rec{n}.wav")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(RATE), res])
    return read_wav(res)


def db(x: float) -> float:
    return 10 ** (x / 20.0)


def active_rms(x: np.ndarray) -> float:
    frame = int(0.05 * RATE)
    n = x.size // frame
    if n == 0:
        return 1e-9
    f = x[: n * frame].reshape(n, frame)
    r = np.sqrt((f**2).mean(axis=1))
    act = r[r > r.max() * 0.1]
    return float(np.sqrt((act**2).mean())) if act.size else 1e-9


# ---------------------------------------------------------------------------
# Music: an original ambient bed (deterministic)
# ---------------------------------------------------------------------------

def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def pad_voice(freq: float, dur: float, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(dur * RATE)) / RATE
    out = np.zeros_like(t)
    for k, amp in ((1, 1.0), (2, 0.28), (3, 0.12), (4, 0.05)):
        for detune in (-0.0025, 0.0025):
            ph = rng.uniform(0, 2 * math.pi)
            out += amp * np.sin(2 * math.pi * freq * k * (1 + detune) * t + ph)
    att, rel = min(2.5, dur / 3), min(3.0, dur / 2.5)
    env = np.minimum(1.0, t / att) * np.minimum(1.0, (dur - t) / rel)
    return out * np.clip(env, 0, 1) ** 1.5


def make_music(total: float, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(total * RATE)
    left, right = np.zeros(n), np.zeros(n)
    # Slow progression, 8 s per chord, soft voicings around middle C (no melody).
    chords = [
        [48, 55, 60, 64, 71],  # Cmaj7
        [45, 52, 57, 60, 67],  # Am7
        [41, 48, 53, 57, 64],  # Fmaj7
        [43, 50, 55, 59, 62],  # G6
    ]
    step, length = 8.0, 10.5  # overlapping chords crossfade
    i, start = 0, 0.0
    while start < total:
        notes = chords[i % len(chords)]
        dur = min(length, total - start + 0.5)
        s = int(start * RATE)
        for j, note in enumerate(notes):
            v = pad_voice(midi(note), dur, rng) * (0.55 if j == 0 else 0.32)
            pan = 0.5 + (j - 2) * 0.12
            e = min(n, s + v.size)
            left[s:e] += v[: e - s] * (1 - pan)
            right[s:e] += v[: e - s] * pan
        i += 1
        start += step
    # Slow pulse: a soft, low thump every 2 s (sine with a quick decay), centred.
    t_pulse = np.arange(int(0.9 * RATE)) / RATE
    thump = np.sin(2 * math.pi * midi(36) * t_pulse) * np.exp(-t_pulse * 5.5) * 0.35
    k = 0.0
    while k < total:
        s = int(k * RATE)
        e = min(n, s + thump.size)
        left[s:e] += thump[: e - s]
        right[s:e] += thump[: e - s]
        k += 2.0
    # Gentle movement: a 0.07 Hz amplitude swell; a one-pole low-pass keeps it soft.
    t = np.arange(n) / RATE
    swell = 0.85 + 0.15 * np.sin(2 * math.pi * 0.07 * t)
    stereo = np.stack([left * swell, right * swell])
    # Soft low-pass (FFT, smooth roll-off above ~2.2 kHz) so nothing glitters under the voice.
    spec = np.fft.rfft(stereo, axis=1)
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spec *= 1 / (1 + (freqs / 2200.0) ** 4)
    stereo = np.fft.irfft(spec, n=n, axis=1)
    return stereo / np.abs(stereo).max()


def envelope(total: float, speech: list[tuple[float, float]], fade_in=2.5, fade_out=3.5) -> np.ndarray:
    n = int(total * RATE)
    g = np.full(n, db(MUSIC_IN_GAPS_DB))
    for a, b in speech:
        s, e = int(max(0, a - 0.25) * RATE), int(min(total, b + 0.35) * RATE)
        g[s:e] = db(MUSIC_UNDER_SPEECH_DB)
    # Smooth the ducking (≈ 250 ms ramps).
    k = int(0.25 * RATE)
    g = np.convolve(g, np.ones(k) / k, mode="same")
    t = np.arange(n) / RATE
    g *= np.minimum(1, t / fade_in) * np.minimum(1, np.maximum(0, (total - t) / fade_out))
    return g


def encode(wav: str, base: str, channels: int) -> None:
    opus = "32k" if channels == 1 else "48k"
    aac = "48k" if channels == 1 else "64k"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", opus,
         "-application", "voip" if channels == 1 else "audio", f"{base}.webm"])
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "aac", "-b:a", aac,
         "-movflags", "+faststart", f"{base}.m4a"])


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--piper-python", default=sys.executable)
    ap.add_argument("--model")
    ap.add_argument("--speaker", type=int, default=0)
    ap.add_argument("--length-scale", type=float, default=0.92)
    ap.add_argument("--voice-dir", help="use recorded WAVs instead of TTS")
    ap.add_argument("--mix-out", help="also write the full mixed track (WAV) for the MP4")
    ap.add_argument("--mix-path", default="decide", choices=PATHS)
    args = ap.parse_args()
    if not args.voice_dir and not args.model:
        ap.error("--model (Piper voice) or --voice-dir (recordings) is required")

    nar = json.load(open(NARRATION, encoding="utf-8"))
    os.makedirs(OUT_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        counter = [0]

        def voice_for(text: str, recording: str | None) -> np.ndarray:
            counter[0] += 1
            if args.voice_dir and recording:
                return trim_silence(recorded(os.path.join(args.voice_dir, recording), tmp, counter[0]))
            return synthesize(text, args, tmp, counter[0])

        # Synthesize every cue (role lines separately) and normalise the speech level.
        cue_audio: dict[tuple[str, int, str], np.ndarray] = {}
        for ch in nar["chapters"]:
            for i, cue in enumerate(ch["cues"]):
                if ch["id"] == "role" and i == 0:
                    for p in PATHS:
                        cue_audio[(ch["id"], i, p)] = voice_for(nar["roleLines"][p], f"role-{p}.wav")
                else:
                    cue_audio[(ch["id"], i, "")] = voice_for(cue["text"], f"{ch['id']}-{i + 1}.wav")
        all_speech = np.concatenate(list(cue_audio.values()))
        gain = db(VOICE_RMS_DB) / active_rms(all_speech)
        for k in cue_audio:
            cue_audio[k] = cue_audio[k] * gain

        # Timing.
        timing = {"chapters": []}
        starts, offset = {}, 0.0
        speech_union: list[tuple[float, float]] = []
        voices: dict[str, np.ndarray] = {}
        for ch in nar["chapters"]:
            cid = ch["id"]
            cues_t = []
            cursor = LEAD_IN
            for i, cue in enumerate(ch["cues"]):
                variants = [p for p in PATHS] if (cid == "role" and i == 0) else [""]
                length = max(cue_audio[(cid, i, v)].size for v in variants) / RATE
                at = max(cue["designAt"] + (LEAD_IN if cue["designAt"] == 0 else 0), cursor)
                cues_t.append({"at": round(at, 2), "end": round(at + length, 2)})
                cursor = at + length + GAP
            duration = round(max(ch["minDuration"], cues_t[-1]["end"] + TAIL), 1)
            timing["chapters"].append({"id": cid, "duration": duration, "cues": cues_t})
            starts[cid] = offset
            for q in cues_t:
                speech_union.append((offset + q["at"], offset + q["end"]))
            # Build the chapter voice file(s), padded to the chapter length.
            variants = PATHS if cid == "role" else [""]
            for v in variants:
                buf = np.zeros(int(duration * RATE))
                for i, q in enumerate(cues_t):
                    a = cue_audio[(cid, i, v if (cid == "role" and i == 0) else "")]
                    s = int(q["at"] * RATE)
                    buf[s : s + a.size] += a[: max(0, buf.size - s)]
                voices[f"role-{v}" if v else cid] = buf
            offset += duration
        total = round(offset, 1)
        timing["total"] = total
        timing["voice"] = {
            "engine": "Piper (local neural TTS)" if not args.voice_dir else "Recorded voice",
            "model": os.path.basename(args.model) if args.model and not args.voice_dir else None,
            "speaker": args.speaker if not args.voice_dir else None,
        }
        with open(TIMING, "w", encoding="utf-8") as f:
            json.dump(timing, f, indent=2)
            f.write("\n")

        # Music bed, ducked under speech.
        # Music bed: scaled so its full level equals the speech level, then the envelope puts it
        # MUSIC_UNDER_SPEECH_DB under the voice while someone speaks and MUSIC_IN_GAPS_DB in the pauses.
        music = make_music(total)[:, : int(total * RATE)]
        music = music / max(1e-9, active_rms(music.mean(axis=0))) * db(VOICE_RMS_DB)
        music = music * envelope(total, speech_union)

        for name, buf in voices.items():
            w = os.path.join(tmp, f"{name}.wav")
            write_wav(w, buf)
            encode(w, os.path.join(OUT_DIR, f"voice-{name}"), 1)
        mw = os.path.join(tmp, "music.wav")
        write_wav(mw, music.T.reshape(-1), channels=2)
        encode(mw, os.path.join(OUT_DIR, "music"), 2)

        if args.mix_out:
            seq = [voices[c["id"]] if c["id"] != "role" else voices[f"role-{args.mix_path}"]
                   for c in timing["chapters"]]
            v = np.concatenate(seq)[: music.shape[1]]
            mix = np.stack([v, v]) + music[:, : v.size]
            mix /= max(1.0, float(np.abs(mix).max()) / 0.95)
            write_wav(args.mix_out, mix.T.reshape(-1), channels=2)

    sizes = {f: os.path.getsize(os.path.join(OUT_DIR, f)) for f in sorted(os.listdir(OUT_DIR))}
    print(json.dumps({"total": total, "files": sizes}, indent=1))


if __name__ == "__main__":
    main()
