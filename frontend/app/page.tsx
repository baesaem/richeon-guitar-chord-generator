"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordTimeline } from "@/components/ChordTimeline";
import { PlayerPane } from "@/components/PlayerPane";
import { analyzeUpload, analyzeUrl, getHealth, getResult, watchJob } from "@/lib/api";
import { barIndexAt, buildBars, chordIndexAt } from "@/lib/bars";
import { spell, spellKey, prefersFlats } from "@/lib/notation";
import { STAGE_LABEL, type AnalysisResult, type Health, type JobStatus } from "@/lib/types";
import { voicingFor } from "@/lib/voicings";

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [url, setUrl] = useState("");
  const [separate, setSeparate] = useState(true);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [chordIdx, setChordIdx] = useState(-1);
  const [barIdx, setBarIdx] = useState(0);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError(`백엔드 연결 실패: ${e.message}`));
  }, []);

  const bars = useMemo(() => (result ? buildBars(result) : []), [result]);
  const flats = useMemo(() => (result ? prefersFlats(result.key) : false), [result]);

  const handleTime = useCallback(
    (t: number) => {
      if (!result) return;
      setChordIdx(chordIndexAt(result.chords, t));
      setBarIdx(barIndexAt(bars, t));
    },
    [result, bars],
  );

  const run = async (start: () => Promise<{ job_id: string }>) => {
    setError(null);
    setResult(null);
    setStatus(null);
    setChordIdx(-1);
    setBarIdx(0);
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

  const busy = status !== null && status.stage !== "done" && status.stage !== "failed";
  const current = chordIdx >= 0 ? result?.chords[chordIdx] : undefined;
  const next = result && chordIdx + 1 < result.chords.length
    ? result.chords[chordIdx + 1]
    : undefined;

  return (
    <main className="mx-auto max-w-2xl pb-10">
      {result ? (
        <>
          {/* 재생 + 현재 코드는 화면 위에 고정. 스크롤해도 항상 보인다 */}
          <div className="sticky top-0 z-10 bg-white shadow-sm dark:bg-black">
            <PlayerPane result={result} onTime={handleTime} />

            <div className="flex items-center gap-3 px-3 py-2">
              <ChordDiagram
                voicing={current ? voicingFor(current.root, current.quality) : null}
                label={current?.label ?? ""}
                width={104}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-4xl font-bold leading-none">
                  {current ? spell(current.label, flats) : "—"}
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  다음 {next ? spell(next.label, flats) : "—"}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  {spellKey(result.key)} · {Math.round(result.bpm)} BPM ·{" "}
                  {result.time_signature} · {barIdx + 1}/{bars.length}마디
                </div>
              </div>
              {next && (
                <ChordDiagram
                  voicing={voicingFor(next.root, next.quality)}
                  label={next.label}
                  width={72}
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              재생 따라가기
            </label>
            <button
              className="text-gray-500 underline"
              onClick={() => {
                setResult(null);
                setStatus(null);
                setUrl("");
              }}
            >
              다른 곡 분석
            </button>
          </div>

          <div className="px-3">
            <ChordTimeline
              bars={bars}
              currentBar={barIdx}
              flats={flats}
              follow={follow}
            />
          </div>
        </>
      ) : (
        <div className="space-y-5 p-4">
          <header>
            <h1 className="text-2xl font-bold">기타 코드 자동 추출</h1>
            <p className="text-sm text-gray-500">
              {health
                ? `${health.device} · ${health.pipeline_version}` +
                  (health.youtube_enabled ? "" : " · 업로드 전용")
                : "백엔드 확인 중…"}
            </p>
          </header>

          {health && !health.ffmpeg && (
            <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
              ffmpeg / ffprobe를 찾을 수 없습니다. 설치 후 PATH에 추가해야 분석이 가능합니다.
            </p>
          )}

          {health?.youtube_enabled && (
            <section className="space-y-2">
              <label className="text-sm font-medium">YouTube 주소</label>
              <input
                className="w-full rounded border px-3 py-3 text-base"
                placeholder="https://www.youtube.com/watch?v=..."
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                className="w-full rounded bg-black py-3 text-white disabled:opacity-40 dark:bg-white dark:text-black"
                disabled={!url || busy}
                onClick={() => run(() => analyzeUrl(url, separate))}
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
                if (f) run(() => analyzeUpload(f, separate));
              }}
            />
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={separate}
              onChange={(e) => setSeparate(e.target.checked)}
            />
            음원 분리 사용 (느리지만 정확도가 올라감)
          </label>

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

          {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </main>
  );
}
