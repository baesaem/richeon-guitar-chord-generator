"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import { BottomNav, type Tab } from "@/components/BottomNav";
import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { ChordStrip, type ChordStripHandle } from "@/components/ChordStrip";
import { ChordScore } from "@/components/ChordScore";
import { ChordSheet } from "@/components/ChordSheet";
import { Copyright } from "@/components/Copyright";
import { HomeDashboard } from "@/components/HomeDashboard";
import { LyricsPane } from "@/components/LyricsPane";
import { PlayerPane, type Playback } from "@/components/PlayerPane";
import { PlaySettings, SeekBar } from "@/components/TransportBar";
import { ChordsTab } from "@/components/tabs/ChordsTab";
import { ImportTab } from "@/components/tabs/ImportTab";
import { LibraryTab } from "@/components/tabs/LibraryTab";
import { RecordTab } from "@/components/tabs/RecordTab";
import { SettingsTab } from "@/components/tabs/SettingsTab";
import {
  analyzeUpload,
  analyzeUrl,
  getHealth,
  getResult,
  makeInstrumental,
  watchJob,
} from "@/lib/api";
import { barIndexAt, buildBars, chordIndexAt } from "@/lib/bars";
import { getLocal, saveLocal } from "@/lib/library";
import {
  labelFor,
  resolveFlats,
  simplifyQuality,
  spellKey,
  transposeRoot,
} from "@/lib/notation";
import { addRecent } from "@/lib/recent";
import { useSettings } from "@/lib/settings";
import { tidyChords } from "@/lib/tidy";
import { STAGE_LABEL, type AnalysisResult, type Health, type JobStatus } from "@/lib/types";
import { voicingFor } from "@/lib/voicings";

export default function Home() {
  const [tab, setTab] = useState<Tab>("home");
  // 홈에서 「강상기타반」으로 들어오면 그 카드를 바로 펼친다
  const [importCard, setImportCard] = useState<"shared" | undefined>(undefined);
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
  // 가사 보기: 켜면 코드 박스와 곡 전체 코드 자리를 가사가 대신 쓴다
  const [showLyrics, setShowLyrics] = useState(false);
  // 보컬 끄기(반주만). 서버가 만든 반주 트랙이 있어야 한다.
  const [vocalOff, setVocalOff] = useState(false);
  const [vocalBusy, setVocalBusy] = useState(false);
  const [vocalError, setVocalError] = useState<string | null>(null);

  const [backendDown, setBackendDown] = useState(false);

  // 설정에서 서버 주소를 바꾸면 다시 확인한다.
  // 강상기타반 곡은 자동으로 담지 않는다 - 수강생이 음원 가져오기의
  // 강상기타반 목록에서 필요한 곡만 골라 받는다.
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

  // 테마 적용: html에 .dark 클래스를 붙였다 뗀다. system이면 기기 설정을 따라간다.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        settings.theme === "dark" || (settings.theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      // 세피아·아쿠아는 라이트 기반 색조 팔레트
      if (["sepia", "aqua", "royal", "naver"].includes(settings.theme)) {
        document.documentElement.dataset.theme = settings.theme;
      } else {
        delete document.documentElement.dataset.theme;
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);

  // 화면에 그릴 결과.
  // 1) 「기본」 어휘면 확장 화음을 3화음으로 낮춘다.
  // 2) 스치는 오인식·짧은 무음을 걷어내고 같은 코드는 하나로 잇는다.
  //    낮추고 나서 다듬어야 Cmaj7→C가 옆 C와 합쳐진다.
  const shown = useMemo(() => {
    if (!result) return result;
    const simplified =
      settings.chordVocab === "all"
        ? result.chords
        : result.chords.map((c) => ({
            ...c,
            quality: simplifyQuality(c.quality, "basic"),
          }));
    return { ...result, chords: tidyChords(simplified, result.bpm) };
  }, [result, settings.chordVocab]);

  const bars = useMemo(() => (result ? buildBars(result) : []), [result]);
  const flats = useMemo(
    () => (result ? resolveFlats(result.key, settings.notation) : false),
    [result, settings.notation],
  );

  // 재생 위치를 매 프레임 읽어 타임라인을 그린다. 상태는 값이 바뀔 때만 갱신.
  useEffect(() => {
    if (!playback || !shown) return;

    let raf = 0;
    let lastTick = -1;
    const frame = () => {
      const t = playback.getTime();
      stripRef.current?.draw(t);
      // 다듬은 목록 기준으로 세어야 화면에 그린 코드와 인덱스가 맞는다
      setChordIdx(chordIndexAt(shown.chords, t));
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
  }, [playback, shown, bars, loop]);

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
    setVocalOff(false);
    setVocalError(null);
  };

  /** 보컬 끄기: 반주 트랙을 준비시킨 뒤에 켠다. */
  const toggleVocalOff = async (off: boolean) => {
    setVocalError(null);
    if (!off || !result) {
      setVocalOff(false);
      return;
    }
    setVocalBusy(true);
    try {
      await makeInstrumental(result.id);
      setVocalOff(true);
    } catch (e) {
      setVocalError(`반주를 준비하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setVocalBusy(false);
    }
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
              addRecent(r.id, r.title || r.id);
              // 서버(PC)가 꺼져도 열 수 있도록 기기에도 저장해 둔다
              if (settings.autoSave) saveLocal(r).catch(() => {});
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
      // 서버가 붙어 있으면 서버 것을 쓴다. 분석을 고치면 서버 결과가 먼저
      // 새로워지는데, 기기 저장분을 우선하면 옛 결과가 계속 열린다.
      // 서버가 없는 수강생 기기에서는 곧바로 기기 저장분으로 간다.
      const result = health
        ? await getResult(id).catch(() => getLocal(id))
        : await getLocal(id);
      if (!result) throw new Error("결과 없음");
      setResult(result);
      addRecent(result.id, result.title || result.id);
    } catch {
      setError("이 곡을 열 수 없습니다. 기기에 저장돼 있지 않고 서버에도 연결되지 않았습니다.");
    }
  };

  const busy = status !== null && status.stage !== "done" && status.stage !== "failed";

  const shownChords = shown?.chords ?? [];
  const current = chordIdx >= 0 ? shownChords[chordIdx] : undefined;
  const next =
    chordIdx + 1 < shownChords.length ? shownChords[chordIdx + 1] : undefined;

  const view = (c: typeof current) =>
    c
      ? {
          root: transposeRoot(c.root, -transpose),
          label: labelFor(transposeRoot(c.root, -transpose), c.quality, flats),
          quality: c.quality,
        }
      : undefined;

  const cur = view(current);
  const nxt = view(next);

  // 음높이 +n = 카포 n프렛. 카포가 소리를 n만큼 올려주므로
  // 화면 코드 표기는 반대로 n만큼 내린 모양이어야 원곡 소리가 난다.
  const noteShift = -transpose;

  return (
    // w-full이 없으면 mx-auto(가로 auto 마진)가 flex 아이템의 stretch를 무효화해
    // 너비가 내용물 기준으로 잡히고, 긴 곡 제목 때문에 화면이 가로로 넘친다.
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-x-hidden">
      {/* 어느 탭에 있든 앱 이름은 항상 보인다. 테마 강조색이 물드는 타이틀바. */}
      <header className="shrink-0 bg-[var(--bar-bg)]">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]">
            <Image
              src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/guitar.png`}
              alt=""
              width={20}
              height={32}
              className="h-7 w-auto"
              priority
            />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">
            <span className="text-[var(--accent)]">리천</span> 기타 코드 자동생성기
          </h1>
          {settings.adminMode && health && (
            <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
              {health.device}
            </span>
          )}
        </div>
        {/* 강조색 헤어라인 */}
        <div className="h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--accent)_55%,transparent)] to-transparent" />
      </header>

      {/* 서버 관련 안내는 관리자에게만. 수강생 화면은 서버 개념을 모른다. */}
      {backendDown && settings.adminMode && (
        <p className="shrink-0 bg-amber-50 px-3 py-1.5 text-[11px] leading-snug text-amber-800">
          분석 서버에 연결되지 않았습니다. 새 분석은 안 되지만, 재생목록의
          기기 저장 곡과 코드리스트는 그대로 쓸 수 있습니다. 서버 주소는 설정
          탭에서 지정합니다.
        </p>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* 홈 탭은 항상 붙여 둔다. 다른 탭으로 옮겨도 재생이 끊기지 않게. */}
        <div className={tab === "home" ? "flex h-full flex-col overflow-y-auto" : "hidden"}>
          {result ? (
            // 영역을 카드로 묶어 서로 구별한다: 영상 / 타임라인+탐색 / 현재 코드 / 곡 전체
            <>
              <section className="mx-2 mt-1.5 shrink-0 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                <PlayerPane
                  result={result}
                  onReady={setPlayback}
                  compact={settings.videoCompact}
                  vocalOff={vocalOff}
                />
              </section>

              <section className="mx-2 mt-1.5 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
              {/* 파형/코드악보 세그먼트 + 연주설정·영상접기. 글자 크기를 통일한 한 줄. */}
              <div className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
                <div className="flex min-w-0 flex-1 rounded-lg bg-gray-200/70 p-0.5 dark:bg-gray-800">
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
                        "min-w-0 flex-1 truncate rounded-md py-1 text-[13px] font-medium transition-colors",
                        settings.view === value
                          ? "bg-white text-black shadow-sm dark:bg-black dark:text-white"
                          : "text-gray-500",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* 음높이·빠르기·반복을 한 팝업에 모은 버튼 */}
                <PlaySettings
                  duration={result.duration}
                  time={time}
                  transpose={transpose}
                  rate={rate}
                  loop={loop}
                  onTranspose={setTranspose}
                  onRate={(r) => {
                    setRate(r);
                    playback?.setRate(r);
                  }}
                  onLoop={setLoop}
                  vocalOff={vocalOff}
                  vocalBusy={vocalBusy}
                  vocalError={vocalError}
                  onVocalOff={health ? toggleVocalOff : undefined}
                />
                {/* 가사 보기 — 코드 박스·곡 전체 코드 자리를 대신 쓴다 */}
                <button
                  onClick={() => setShowLyrics((v) => !v)}
                  className={[
                    "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-medium",
                    showLyrics
                      ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]"
                      : "bg-gray-200/70 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
                  ].join(" ")}
                  title="가사를 음악에 맞춰 보여줍니다"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 6h11M4 11h7M4 16h9" />
                    <circle cx="18.5" cy="16.5" r="2.5" />
                    <path d="M21 16.5V6l-3 1" />
                  </svg>
                  가사
                </button>
                <button
                  onClick={() =>
                    setSettings({ ...settings, videoCompact: !settings.videoCompact })
                  }
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-gray-200/70 px-2 py-1.5 text-[13px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  title="영상을 접어 코드에 자리를 넘깁니다"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {settings.videoCompact ? (
                      <path d="m6 10 6 6 6-6" />
                    ) : (
                      <path d="m6 14 6-6 6 6" />
                    )}
                  </svg>
                  영상
                </button>
              </div>

              {/* 파형과 코드악보는 같은 자리(영상 바로 아래)를 쓴다 */}
              {settings.view === "wave" ? (
                <ChordStrip
                  ref={stripRef}
                  result={shown ?? result}
                  flats={flats}
                  transpose={noteShift}
                  pixelsPerSecond={settings.pixelsPerSecond}
                  onSeek={(t) => playback?.seek(t)}
                />
              ) : (
                <div className="shrink-0 px-2 py-1">
                  {/* 지금 줄과 다음 줄만. 현재 줄이 늘 위에 온다 */}
                  <ChordScore
                    bars={bars}
                    chords={shownChords}
                    melody={result.melody}
                    strums={result.strums}
                    currentBar={barIdx}
                    flats={flats}
                    transpose={noteShift}
                    timeSignature={result.time_signature}
                    musicKey={result.key}
                    onSeek={(t) => playback?.seek(t)}
                    visibleLines={2}
                    follow
                  />
                </div>
              )}

              <SeekBar
                duration={result.duration}
                time={time}
                playing={playing}
                onSeek={(t) => {
                  playback?.seek(t);
                  setTime(t);
                }}
                onToggle={() => {
                  if (!playback) return;
                  if (playback.isPlaying()) playback.pause();
                  else playback.play();
                }}
              />
              </section>

              {/* 가사 보기: 코드 박스와 곡 전체 코드를 감추고 그 자리에 가사를 띄운다 */}
              {showLyrics ? (
                <section className="mx-2 mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                  <LyricsPane
                    result={result}
                    time={time}
                    online={!!health}
                    onLyrics={(lines) =>
                      setResult((prev) => (prev ? { ...prev, lyrics: lines } : prev))
                    }
                    onSeek={(t) => {
                      playback?.seek(t);
                      setTime(t);
                    }}
                  />
                </section>
              ) : (
              <>
              <section className="mx-2 mt-1.5 flex shrink-0 items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900">
                <ChordDiagram
                  voicing={cur ? voicingFor(cur.root, cur.quality) : null}
                  label={cur?.label ?? ""}
                  width={86}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-3xl font-bold leading-none">
                    {cur ? <ChordLabel label={cur.label} /> : "—"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    다음 {nxt ? <ChordLabel label={nxt.label} /> : "—"}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-gray-400">
                    <ChordLabel label={spellKey(result.key)} /> · {Math.round(result.bpm)} BPM ·{" "}
                    {result.time_signature} · {barIdx + 1}/{bars.length}마디
                  </div>
                </div>
                {nxt && (
                  <div className="flex shrink-0 flex-col items-center">
                    <div className="text-xs font-semibold leading-none text-gray-500">
                      <ChordLabel label={nxt.label} />
                    </div>
                    <ChordDiagram
                      voicing={voicingFor(nxt.root, nxt.quality)}
                      label={nxt.label}
                      width={64}
                      showFingers={false}
                    />
                  </div>
                )}
              </section>

              {/* 곡 전체를 훑는 마디 그리드. 4칸 × 2줄 높이, 감추기 가능 */}
              <section className="mx-2 mt-1.5 shrink-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-gray-500">
                    곡 전체 코드
                  </span>
                  <button
                    className="px-1.5 py-0.5 text-[11px] text-gray-500 underline"
                    onClick={() =>
                      setSettings({ ...settings, showGrid: !settings.showGrid })
                    }
                  >
                    {settings.showGrid ? "감추기" : "보이기"}
                  </button>
                </div>
                {settings.showGrid && (
                  <div className="mt-1 h-[104px] overflow-y-auto">
                    <ChordSheet
                      bars={bars}
                      chords={shownChords}
                      currentBar={barIdx}
                      currentChord={chordIdx}
                      flats={flats}
                      transpose={noteShift}
                      follow={settings.view === "wave"}
                    />
                  </div>
                )}
              </section>

              <div className="min-h-0 flex-1 overflow-y-auto px-3">
                <Copyright />
              </div>
              </>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col">
              <HomeDashboard
                onOpen={openSaved}
                onImport={() => {
                  setImportCard(undefined);
                  setTab("import");
                }}
                onShared={() => {
                  setImportCard("shared");
                  setTab("import");
                }}
                onLibrary={() => setTab("library")}
                onChords={() => setTab("chords")}
              />
              <div className="space-y-2 px-4">
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
            adminMode={settings.adminMode}
            autoOpen={importCard}
            onAnalyzeUrl={(u) => run(() => analyzeUrl(u, settings.separate))}
            onAnalyzeFile={(f) => run(() => analyzeUpload(f, settings.separate))}
          />
        )}

        {tab === "library" && (
          <LibraryTab
            active
            onOpen={openSaved}
            adminMode={settings.adminMode}
            // 서버가 있을 때만. 캐시된 오디오를 쓰므로 다시 받지 않는다.
            onReanalyze={
              health
                ? (id) =>
                    run(() =>
                      analyzeUrl(
                        `https://www.youtube.com/watch?v=${id}`,
                        settings.separate,
                        true,
                      ),
                    )
                : undefined
            }
          />
        )}

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
