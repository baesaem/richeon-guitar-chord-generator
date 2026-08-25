"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { BottomNav, type Tab } from "@/components/BottomNav";
import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordStrip, type ChordStripHandle } from "@/components/ChordStrip";
import { ChordSheet } from "@/components/ChordSheet";
import { Copyright } from "@/components/Copyright";
import { PlayerPane, type Playback } from "@/components/PlayerPane";
import { TransportBar } from "@/components/TransportBar";
import { ChordsTab } from "@/components/tabs/ChordsTab";
import { LibraryTab } from "@/components/tabs/LibraryTab";
import { RecordTab } from "@/components/tabs/RecordTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import { analyzeUpload, analyzeUrl, getHealth, getResult, watchJob } from "@/lib/api";
import { barIndexAt, buildBars, chordIndexAt } from "@/lib/bars";
import { labelFor, resolveFlats, spellKey, transposeRoot } from "@/lib/notation";
import { useSettings } from "@/lib/settings";
import { STAGE_LABEL, type AnalysisResult, type Health, type JobStatus } from "@/lib/types";
import { voicingFor } from "@/lib/voicings";

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  const [settings, setSettings] = useSettings();

  const [health, setHealth] = useState<Health | null>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [playback, setPlayback] = useState<Playback | null>(null);
  const stripRef = useRef<ChordStripHandle | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [chordIdx, setChordIdx] = useState(-1);
  const [barIdx, setBarIdx] = useState(0);

  const [transpose, setTranspose] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState<{ a: number; b: number } | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError(`백엔드 연결 실패: ${e.message}`));
  }, []);

  const bars = useMemo(() => (result ? buildBars(result) : []), [result]);
  const flats = useMemo(
    () => (result ? resolveFlats(result.key, settings.notation) : false),
    [result, settings.notation],
  );

  // 재생 위치를 매 프레임 읽어 타임라인을 그린다. 상태는 값이 바뀔 때만 갱신.
  useEffect(() => {
    if (!playback || !result) return;

    let raf = 0;
    let lastTick = -1;
    const frame = () => {
      const t = playback.getTime();
      stripRef.current?.draw(t);
      setChordIdx(chordIndexAt(result.chords, t));
      setBarIdx(barIndexAt(bars, t));

      if (loop && loop.b > loop.a && t >= loop.b) playback.seek(loop.a);

      // 시계와 탐색 바는 초당 4번이면 충분하다
      const tick = Math.floor(t * 4);
      if (tick !== lastTick) {
        lastTick = tick;
        setTime(t);
        setPlaying(playback.isPlaying());
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playback, result, bars, loop]);

  const resetPlayback = () => {
    setResult(null);
    setStatus(null);
    setPlayback(null);
    setChordIdx(-1);
    setBarIdx(0);
    setTime(0);
    setTranspose(0);
    setRate(1);
    setLoop(null);
  };

  const run = async (start: () => Promise<{ job_id: string }>) => {
    setError(null);
    resetPlayback();
    setTab("home");
    try {
      const { job_id } = await start();
      watchJob(job_id, (s) => {
        setStatus(s);
        if (s.stage === "done" && s.result_id) {
          getResult(s.result_id).then(setResult).catch((e) => setError(e.message));
        }
        if (s.stage === "failed") setError(s.error ?? "분석에 실패했습니다");
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openSaved = async (id: string) => {
    setError(null);
    resetPlayback();
    setTab("home");
    try {
      setResult(await getResult(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const busy = status !== null && status.stage !== "done" && status.stage !== "failed";

  const current = result && chordIdx >= 0 ? result.chords[chordIdx] : undefined;
  const next =
    result && chordIdx + 1 < result.chords.length ? result.chords[chordIdx + 1] : undefined;

  const view = (c: typeof current) =>
    c
      ? {
          root: transposeRoot(c.root, transpose),
          label: labelFor(transposeRoot(c.root, transpose), c.quality, flats),
          quality: c.quality,
        }
      : undefined;

  const cur = view(current);
  const nxt = view(next);

  return (
    // w-full이 없으면 mx-auto(가로 auto 마진)가 flex 아이템의 stretch를 무효화해
    // 너비가 내용물 기준으로 잡히고, 긴 곡 제목 때문에 화면이 가로로 넘친다.
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-x-hidden">
      <div className="min-h-0 min-w-0 flex-1">
        {/* 홈 탭은 항상 붙여 둔다. 다른 탭으로 옮겨도 재생이 끊기지 않게. */}
        <div className={tab === "home" ? "flex h-full flex-col" : "hidden"}>
          {result ? (
            <>
              <PlayerPane result={result} onReady={setPlayback} />

              {/* 파형 / 코드악보 전환 */}
              <div className="flex gap-1 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
                {(
                  [
                    ["wave", "파형"],
                    ["sheet", "코드악보"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setSettings({ ...settings, view: value })}
                    className={[
                      "flex-1 rounded py-1.5 text-sm",
                      settings.view === value
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "bg-gray-100 dark:bg-gray-800",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {settings.view === "wave" && (
                <ChordStrip
                  ref={stripRef}
                  result={result}
                  flats={flats}
                  transpose={transpose}
                  pixelsPerSecond={settings.pixelsPerSecond}
                  onSeek={(t) => playback?.seek(t)}
                />
              )}

              <div className="flex items-center gap-3 border-y border-gray-200 px-3 py-2 dark:border-gray-800">
                <ChordDiagram
                  voicing={cur ? voicingFor(cur.root, cur.quality) : null}
                  label={cur?.label ?? ""}
                  width={104}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-3xl font-bold leading-none">
                    {cur?.label ?? "—"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">다음 {nxt?.label ?? "—"}</div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-400">
                    {spellKey(result.key)} · {Math.round(result.bpm)} BPM ·{" "}
                    {result.time_signature} · {barIdx + 1}/{bars.length}마디
                  </div>
                </div>
                {nxt && (
                  <div className="flex shrink-0 flex-col items-center">
                    <div className="text-xs font-semibold leading-none text-gray-500">
                      {nxt.label}
                    </div>
                    <ChordDiagram
                      voicing={voicingFor(nxt.root, nxt.quality)}
                      label={nxt.label}
                      width={64}
                      showFingers={false}
                    />
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                <ChordSheet
                  bars={bars}
                  chords={result.chords}
                  currentBar={barIdx}
                  currentChord={chordIdx}
                  flats={flats}
                  transpose={transpose}
                  follow
                />
                <button
                  className="mt-3 w-full py-2 text-xs text-gray-500 underline"
                  onClick={() => {
                    resetPlayback();
                    setUrl("");
                  }}
                >
                  다른 곡 분석
                </button>
                <Copyright />
              </div>

              <TransportBar
                duration={result.duration}
                time={time}
                playing={playing}
                transpose={transpose}
                rate={rate}
                loop={loop}
                onSeek={(t) => {
                  playback?.seek(t);
                  setTime(t);
                }}
                onToggle={() => {
                  if (!playback) return;
                  if (playback.isPlaying()) playback.pause();
                  else playback.play();
                }}
                onTranspose={setTranspose}
                onRate={(r) => {
                  setRate(r);
                  playback?.setRate(r);
                }}
                onLoop={setLoop}
              />
            </>
          ) : (
            <div className="h-full space-y-5 overflow-y-auto p-4">
              <header>
                <h1 className="text-2xl font-bold">리천 기타 코드 자동생성기</h1>
                <p className="text-sm text-gray-500">
                  {health
                    ? `${health.device} · ${health.pipeline_version}` +
                      (health.youtube_enabled ? "" : " · 업로드 전용")
                    : "백엔드 확인 중…"}
                </p>
              </header>

              {health && !health.ffmpeg && (
                <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
                  ffmpeg / ffprobe를 찾을 수 없습니다. 설치 후 PATH에 추가해야 분석이
                  가능합니다.
                </p>
              )}

              {health?.youtube_enabled && (
                <section className="space-y-2">
                  <label className="text-sm font-medium">YouTube 주소</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded border px-3 py-3 text-base"
                      placeholder="https://www.youtube.com/watch?v=..."
                      inputMode="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                    {/* 곡을 찾아 주소를 복사해 오도록 유튜브를 새 탭으로 연다 */}
                    <a
                      href="https://www.youtube.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded border"
                      aria-label="YouTube 열기"
                      title="YouTube 열기"
                    >
                      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
                        <rect x="1" y="5" width="22" height="14" rx="4" fill="#FF0000" />
                        <path d="M10 8.8v6.4l5.5-3.2z" fill="#fff" />
                      </svg>
                    </a>
                  </div>
                  <button
                    className="w-full rounded bg-black py-3 text-white disabled:opacity-40 dark:bg-white dark:text-black"
                    disabled={!url || busy}
                    onClick={() => run(() => analyzeUrl(url, settings.separate))}
                  >
                    분석
                  </button>
                </section>
              )}

              <section className="space-y-2">
                <label className="text-sm font-medium">오디오 파일</label>
                <input
                  type="file"
                  accept="audio/*"
                  className="block w-full text-sm"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) run(() => analyzeUpload(f, settings.separate));
                  }}
                />
              </section>

              <p className="text-xs text-gray-500">
                음원 분리 {settings.separate ? "사용" : "안 함"} · 설정 탭에서 바꿀 수 있습니다.
              </p>

              {status && (
                <section className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{STAGE_LABEL[status.stage]}</span>
                    <span>{Math.round(status.progress * 100)}%</span>
                  </div>
                  <div className="h-2 w-full rounded bg-gray-200">
                    <div
                      className="h-2 rounded bg-black transition-all dark:bg-white"
                      style={{ width: `${status.progress * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">{status.message}</p>
                </section>
              )}

              {error && (
                <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
              )}

              <Copyright />
            </div>
          )}
        </div>

        {tab === "library" && <LibraryTab active onOpen={openSaved} />}

        {tab === "mic" && (
          <RecordTab
            busy={busy}
            onRecorded={(file) => run(() => analyzeUpload(file, settings.separate))}
          />
        )}

        {tab === "chords" && <ChordsTab />}

        {tab === "settings" && (
          <SettingsTab settings={settings} onChange={setSettings} health={health} />
        )}
      </div>

      <BottomNav tab={tab} onChange={setTab} />
    </div>
  );
}
