"use client";

import { useRef, useState } from "react";

import {
  dropScore,
  dropSheetImage,
  moveSheetImage,
  readSheetImage,
  putScore,
  putSheetImage,
} from "@/lib/api";
import type { ScoreAlign, ScoreData } from "@/lib/scoreStaff";
import type { AnalysisResult } from "@/lib/types";

/**
 * 정식 악보 붙이기 — 강사님 화면에만 나온다.
 *
 * 보컬에서 딴 멜로디는 부른 음의 15~30%밖에 잡히지 않아 뼈대만 남는다.
 * 악보 파일(뮤즈스코어 .mscz·.mscx, MusicXML .musicxml·.mxl)을 붙이면
 * 음표가 하나도 빠지지 않고, 가사도 음표에
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
    | {
        bars: unknown[];
        source: string;
        repeats: number;
        offset: number;
        /** 부르는 차례. AI가 되돌이를 읽으면 적힌 마디보다 길어진다 */
        passes?: unknown[][];
      }
    | null
    | undefined;

  /**
   * 악보 그림을 음원 위에서 앞뒤로 민다.
   *
   * 악보 파일이 함께 붙어 있으면 마디 시각이 이미 정확하므로
   * 밀 일이 없다. 그림만 있는 곡은 음원의 박 격자에 고르게 얹은 것이라,
   * 「악보 1마디가 음원의 몇 마디째인가」를 사람이 한 번 짚어 줘야 한다.
   */
  const move = async (offset: number, repeats: number) => {
    setBusy(true);
    setError(null);
    try {
      onResult(await moveSheetImage(result.id, offset, repeats));
    } catch (e) {
      setError(e instanceof Error ? e.message : "옮기지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 되돌이 표시를 AI에게 읽힌다.
   *
   * 도돌이표의 점 두 개는 그림에서도 찾히지만, 1·2번 괄호의 숫자와
   * 「D.S. al Coda」 같은 글자는 모양만 봐서는 읽지 못한다.
   */
  const readMarks = async () => {
    setBusy(true);
    setError(null);
    try {
      onResult(await readSheetImage(result.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "읽지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

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
          악보 파일(.mscz · MusicXML)을 함께 붙이면 마디 시각이 더 정확합니다.
        </span>
      )}

      {sheet && (
        <span className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
          · 그림 {sheet.bars.length}마디
          {sheet.source === "score" ? (
            " (악보 파일에 맞춤)"
          ) : sheet.source === "repeat" ? (
            <span className="text-emerald-600">
              (악보 파일의 되돌이 · {sheet.passes?.[0]?.length ?? 0}마디 부름)
            </span>
          ) : sheet.source === "read" ? (
            <>
              <span className="text-emerald-600">
                (AI가 읽은 되돌이 · {sheet.passes?.[0]?.length ?? 0}마디 부름)
              </span>
              <button
                className="rounded bg-gray-200/70 px-1.5 py-0.5 disabled:opacity-40 dark:bg-gray-700"
                disabled={busy || !online}
                onClick={() => void readMarks()}
                title="AI에게 다시 읽힙니다"
              >
                다시 읽기
              </button>
            </>
          ) : (
            <>
              <span className="text-gray-500">
                · 시작 {sheet.offset > 0 ? "+" : ""}
                {sheet.offset}마디
              </span>
              <button
                className="rounded bg-gray-200/70 px-1.5 py-0.5 disabled:opacity-40 dark:bg-gray-700"
                disabled={busy || !online}
                onClick={() => void move(sheet.offset - 1, sheet.repeats)}
                title="악보를 한 마디 앞으로"
              >
                ◀
              </button>
              <button
                className="rounded bg-gray-200/70 px-1.5 py-0.5 disabled:opacity-40 dark:bg-gray-700"
                disabled={busy || !online}
                onClick={() => void move(sheet.offset + 1, sheet.repeats)}
                title="악보를 한 마디 뒤로"
              >
                ▶
              </button>
              <button
                className="rounded bg-gray-200/70 px-1.5 py-0.5 font-semibold disabled:opacity-40 dark:bg-gray-700"
                disabled={busy || !online}
                onClick={() => void readMarks()}
                title="도돌이표·1·2번 괄호·D.S.를 AI가 읽어 부르는 차례를 폅니다"
              >
                AI로 되돌이 읽기
              </button>
              <select
                className="rounded bg-gray-200/70 px-1 py-0.5 dark:bg-gray-700"
                value={sheet.repeats}
                disabled={busy || !online}
                onChange={(e) => void move(sheet.offset, Number(e.target.value))}
                title="악보 한 벌을 몇 번 되풀이해 부르는가"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}번 되풀이
                  </option>
                ))}
              </select>
            </>
          )}
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
        accept=".mscz,.mscx,.musicxml,.mxl,.xml"
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
