"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { BottomNav, type Tab } from "@/components/BottomNav";
import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordStrip, type ChordStripHandle } from "@/components/ChordStrip";
import { ChordScore } from "@/components/ChordScore";
import { ChordSheet } from "@/components/ChordSheet";
import { Copyright } from "@/components/Copyright";
import { PlayerPane, type Playback } from "@/components/PlayerPane";
import { TransportBar } from "@/components/TransportBar";
import { ChordsTab } from "@/components/tabs/ChordsTab";
import { ImportTab } from "@/components/tabs/ImportTab";
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

  const [backendDown, setBackendDown] = useState(false);

  // 설정에서 서버 주소를 바꾸면 다시 확인한다
  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setBackendDown(false);
      })
      .catch(() => {
        setHealth(null);
        setBackendDown(true);
      });
  }, [settings.apiBase]);

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
    // 탭은 그대로 둔다. 진행률을 보던 자리에서 계속 보고, 끝나면 재생 화면으로 넘어간다.
    try {
      const { job_id } = await start();
      watchJob(job_id, (s) => {
        setStatus(s);
        if (s.stage === "done" && s.result_id) {
          getResult(s.result_id)
            .then((r) => {
              setResult(r);
              setTab("home");
            })
            .catch((e) => setError(e.message));
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
      {/* 어느 탭에 있든 앱 이름은 항상 보인다 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
        <Image
          src="/guitar.png"
          alt=""
          width={20}
          height={32}
          className="h-8 w-auto shrink-0"
          priority
        />
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">
          리천 기타 코드 자동생성기
        </h1>
        {health && (
          <span className="shrink-0 text-[10px] text-gray-400">{health.device}</span>
        )}
      </header>

      {backendDown && (
        <p className="shrink-0 bg-amber-50 px-3 py-1.5 text-[11px] leading-snug text-amber-800">
          분석 서버에 연결되지 않았습니다. 코드리스트만 볼 수 있고 분석은 되지 않습니다.
          집 PC에서 백엔드를 켜거나, 배포 시 <code>NEXT_PUBLIC_API_BASE</code>로 서버
          주소를 지정해 주세요.
        </p>
      )}

      <div className="min-h-0 min-w-0 flex-1">
        {/* 홈 탭은 항상 붙여 둔다. 다른 탭으로 옮겨도 재생이 끊기지 않게. */}
        <div className={tab === "home" ? "flex h-full flex-col" : "hidden"}>
          {result ? (
            <>
              <PlayerPane
                result={result}
                onReady={setPlayback}
                compact={settings.videoCompact}
              />

              {/* 파형 / 코드악보 전환 + 영상 접기 */}
              <div className="flex shrink-0 gap-1 border-b border-gray-200 px-2 py-1 dark:border-gray-800">
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
                      "flex-1 rounded py-1 text-sm",
                      settings.view === value
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "bg-gray-100 dark:bg-gray-800",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
                <button
                  onClick={() =>
                    setSettings({ ...settings, videoCompact: !settings.videoCompact })
                  }
                  className="w-16 shrink-0 rounded bg-gray-100 py-1 text-xs dark:bg-gray-800"
                  title="영상을 접어 코드에 자리를 넘깁니다"
                >
                  {settings.videoCompact ? "영상 펴기" : "영상 접기"}
                </button>
              </div>

              {/* 파형과 코드악보는 같은 자리(영상 바로 아래)를 쓴다 */}
              {settings.view === "wave" ? (
                <ChordStrip
                  ref={stripRef}
                  result={result}
                  flats={flats}
                  transpose={transpose}
                  pixelsPerSecond={settings.pixelsPerSecond}
                  onSeek={(t) => playback?.seek(t)}
                />
              ) : (
                <div className="h-[168px] shrink-0 overflow-y-auto px-2 py-1">
                  <ChordScore
                    bars={bars}
                    chords={result.chords}
                    currentBar={barIdx}
                    flats={flats}
                    transpose={transpose}
                    timeSignature={result.time_signature}
                    musicKey={result.key}
                    onSeek={(t) => playback?.seek(t)}
                    follow
                  />
                </div>
              )}

              <div className="flex shrink-0 items-center gap-3 border-y border-gray-200 px-3 py-1 dark:border-gray-800">
                <ChordDiagram
                  voicing={cur ? voicingFor(cur.root, cur.quality) : null}
                  label={cur?.label ?? ""}
                  width={86}
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
                {/* 아래쪽은 곡 전체를 훑는 마디 그리드. 위 슬롯이 무엇이든 그대로 둔다 */}
                <ChordSheet
                  bars={bars}
                  chords={result.chords}
                  currentBar={barIdx}
                  currentChord={chordIdx}
                  flats={flats}
                  transpose={transpose}
                  follow={settings.view === "wave"}
                />
                <button
                  className="mt-3 w-full py-2 text-xs text-gray-500 underline"
                  onClick={() => {
                    resetPlayback();
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
            <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="max-w-xs text-sm text-gray-500">
                YouTube 주소나 오디오 파일에서 비트·조성·기타 코드를 뽑아 재생과 함께
                보여줍니다.
              </p>
              <div className="flex gap-2">
                <button
                  className="rounded bg-black px-5 py-3 text-white dark:bg-white dark:text-black"
                  onClick={() => setTab("import")}
                >
                  음원 가져오기
                </button>
                <button
                  className="rounded border border-gray-300 px-5 py-3 dark:border-gray-700"
                  onClick={() => setTab("library")}
                >
                  재생목록
                </button>
              </div>
              {status && busy && (
                <p className="text-xs text-gray-500">
                  {STAGE_LABEL[status.stage]} · {Math.round(status.progress * 100)}%
                </p>
              )}
              {error && (
                <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
              )}
              <Copyright />
            </div>
          )}
        </div>

        {tab === "import" && (
          <ImportTab
            health={health}
            status={status}
            error={error}
            busy={busy}
            separate={settings.separate}
            onAnalyzeUrl={(u) => run(() => analyzeUrl(u, settings.separate))}
            onAnalyzeFile={(f) => run(() => analyzeUpload(f, settings.separate))}
          />
        )}

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
