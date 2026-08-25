"use client";

import { useEffect, useRef, useState } from "react";

import {
  analyzeUpload,
  analyzeUrl,
  getHealth,
  getResult,
  watchJob,
} from "@/lib/api";
import { STAGE_LABEL, type AnalysisResult, type Health, type JobStatus } from "@/lib/types";

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [url, setUrl] = useState("");
  const [separate, setSeparate] = useState(true);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError(`백엔드 연결 실패: ${e.message}`));
  }, []);

  const run = async (start: () => Promise<{ job_id: string }>) => {
    setError(null);
    setResult(null);
    setStatus(null);
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

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">기타 코드 자동 추출</h1>
        <p className="text-sm text-gray-500">
          {health
            ? `연산 장치: ${health.device} · 파이프라인 ${health.pipeline_version}` +
              (health.youtube_enabled ? "" : " · 업로드 전용 모드")
            : "백엔드 확인 중…"}
        </p>
      </header>

      {health?.youtube_enabled && (
        <section className="space-y-2">
          <label className="text-sm font-medium">YouTube 주소</label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border px-3 py-2"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
              disabled={!url || busy}
              onClick={() => run(() => analyzeUrl(url, separate))}
            >
              분석
            </button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <label className="text-sm font-medium">오디오 파일 업로드</label>
        <input
          ref={fileRef}
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
              className="h-2 rounded bg-black transition-all"
              style={{ width: `${status.progress * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">{status.message}</p>
        </section>
      )}

      {error && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <section className="space-y-3">
          <div className="flex gap-4 text-sm">
            <span>키 {result.key || "-"}</span>
            <span>{Math.round(result.bpm)} BPM</span>
            <span>{result.time_signature}</span>
            <span className="text-gray-500">{result.meta.chord_model}</span>
          </div>
          {/* TODO(M3): YouTube 플레이어 동기화 타임라인 + 프렛보드 다이어그램으로 교체 */}
          <div className="grid grid-cols-4 gap-2">
            {result.chords.map((c, i) => (
              <div key={i} className="rounded border p-2 text-center">
                <div className="font-semibold">{c.label}</div>
                <div className="text-xs text-gray-400">{c.start.toFixed(1)}s</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
