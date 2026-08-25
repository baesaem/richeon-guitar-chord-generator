"use client";

import { useState } from "react";

import { Copyright } from "@/components/Copyright";
import { STAGE_LABEL, type Health, type JobStatus } from "@/lib/types";

interface Props {
  health: Health | null;
  status: JobStatus | null;
  error: string | null;
  busy: boolean;
  separate: boolean;
  onAnalyzeUrl: (url: string) => void;
  onAnalyzeFile: (file: File) => void;
}

/** 음원 가져오기: YouTube 주소 또는 오디오 파일로 분석을 시작한다. */
export function ImportTab({
  health,
  status,
  error,
  busy,
  separate,
  onAnalyzeUrl,
  onAnalyzeFile,
}: Props) {
  const [url, setUrl] = useState("");

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4">
      <header>
        <h2 className="text-lg font-bold">음원 가져오기</h2>
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
            onClick={() => onAnalyzeUrl(url)}
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
            if (f) onAnalyzeFile(f);
          }}
        />
        <p className="text-[11px] text-gray-500">mp3 · wav · m4a · flac · ogg</p>
      </section>

      <p className="text-xs text-gray-500">
        음원 분리 {separate ? "사용" : "안 함"} · 설정 탭에서 바꿀 수 있습니다.
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

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Copyright />
    </div>
  );
}
