"use client";

import { useRef, useState } from "react";

import { dropScore, dropSheetImage, putScore, putSheetImage } from "@/lib/api";
import type { ScoreAlign, ScoreData } from "@/lib/scoreStaff";
import type { AnalysisResult } from "@/lib/types";

/**
 * 정식 악보 붙이기 — 강사님 화면에만 나온다.
 *
 * 보컬에서 딴 멜로디는 부른 음의 15~30%밖에 잡히지 않아 뼈대만 남는다.
 * 뮤즈스코어 파일을 붙이면 음표가 하나도 빠지지 않고, 가사도 음표에
 * 원래 붙어 있던 그대로 놓인다.
 *
 * 붙이는 즉시 음원의 시각에 이어 두고, **가사가 어긋난 마디**를 세어
 * 알려 준다. 자동 정렬은 어딘가 반드시 틀리는데, 틀린 것을 조용히
 * 넘어가면 수업에서 낭패다. 그 마디에는 악보 위에 점이 찍힌다.
 */
export function ScoreAttach({
  result,
  onResult,
  online,
}: {
  result: AnalysisResult;
  onResult: (r: AnalysisResult) => void;
  online: boolean;
}) {
  const pick = useRef<HTMLInputElement | null>(null);
  const pickImage = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = result.score as ScoreData | null | undefined;
  const align = result.score_align as ScoreAlign | null | undefined;
  const sheet = result.sheet as
    | { bars: unknown[]; source: string; repeats: number }
    | null
    | undefined;

  const attach = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      onResult(await putScore(result.id, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "악보를 붙이지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const attachImage = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      onResult(await putSheetImage(result.id, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "악보 그림을 붙이지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const detachImage = async () => {
    if (!confirm("붙여 둔 악보 그림을 뗍니다. 계속할까요?")) return;
    setBusy(true);
    try {
      onResult(await dropSheetImage(result.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "떼지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    if (!confirm("붙여 둔 악보를 뗍니다. 계속할까요?")) return;
    setBusy(true);
    setError(null);
    try {
      onResult(await dropScore(result.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "악보를 떼지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-gray-500 roomy:text-[13px]">
      {score && align ? (
        <>
          <span className="text-gray-700 dark:text-gray-300">
            악보 {score.bars.length}마디
            {align.passes.length > 1 ? ` · ${align.passes.length}번 되풀이` : ""}
            {align.shift !== 0
              ? ` · ${align.shift > 0 ? "+" : ""}${align.shift}반음 옮겨 그림`
              : ""}
          </span>
          {align.checks.length > 0 ? (
            <span className="text-amber-600">
              손볼 마디 {align.checks.length}곳(점 표시)
            </span>
          ) : (
            <span className="text-emerald-600">어긋난 마디 없음</span>
          )}
        </>
      ) : (
        <span>
          악보 그림(PDF)을 붙이면 인쇄된 악보 위로 커서가 지나갑니다.
          뮤즈스코어 .mscz를 함께 붙이면 마디 시각이 더 정확합니다.
        </span>
      )}

      {sheet && (
        <span className="text-gray-700 dark:text-gray-300">
          · 그림 {sheet.bars.length}마디
          {sheet.source === "score" ? " (악보 파일에 맞춤)" : " (박자에 고르게)"}
        </span>
      )}

      <span className="ml-auto flex shrink-0 gap-1.5">
        <button
          className="rounded bg-gray-200/70 px-2 py-0.5 font-semibold text-gray-900 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-100 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => pickImage.current?.click()}
          title="인쇄된 악보를 그대로 띄우고 그 위로 커서가 지나갑니다"
        >
          {sheet ? "그림 바꾸기" : "악보 그림"}
        </button>
        {sheet && (
          <button
            className="rounded px-2 py-0.5 text-gray-500 underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={detachImage}
          >
            그림 떼기
          </button>
        )}
        <button
          className="rounded bg-gray-200/70 px-2 py-0.5 font-semibold text-gray-900 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-100 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => pick.current?.click()}
          title={online ? "" : "분석 서버에 연결되어야 붙일 수 있습니다"}
        >
          {busy ? "붙이는 중…" : score ? "악보 바꾸기" : "악보 붙이기"}
        </button>
        {score && (
          <button
            className="rounded px-2 py-0.5 text-gray-500 underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={detach}
          >
            떼기
          </button>
        )}
      </span>

      {error && <span className="w-full text-red-600">{error}</span>}

      <input
        ref={pick}
        type="file"
        accept=".mscz,.mscx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void attach(file);
        }}
      />
      <input
        ref={pickImage}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void attachImage(file);
        }}
      />
    </div>
  );
}
