"use client";

import { useRef, useState } from "react";

import { loadSetup } from "@/lib/perSong";

import {
  dropScore,
  dropSheetImage,
  fitSheetImage,
  fixBeats,
  moveSheetImage,
  putSongSetup,
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
  /** 방금 기준값으로 적었다는 표시. 잠깐 보였다 사라진다 */
  const [kept, setKept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 마디 길이와 들쭉날쭉한 정도. 박 사이가 가운데값에서 15% 넘게
  // 벗어난 자리를 센다 — 그런 자리가 곧 진행 바가 튀는 자리다.
  const beatGaps = result.beats
    .slice(1)
    .map((b, i) => b.t - result.beats[i].t)
    .filter((g) => g > 0);
  const beatUnit = beatGaps.length
    ? [...beatGaps].sort((a, b) => a - b)[Math.floor(beatGaps.length / 2)]
    : 0;
  const wobble = beatUnit
    ? beatGaps.filter((g) => Math.abs(g - beatUnit) > beatUnit * 0.15).length
    : 0;

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
  /** 코드가 바뀌는 자리에 마디선을 맞춘다(한 마디 안에서만) */
  const fitBars = async () => {
    setBusy(true);
    setError(null);
    try {
      onResult(await fitSheetImage(result.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "맞추지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

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

  /**
   * 박을 고르게 하거나 빠르기를 절반·두 배로 다시 본다.
   *
   * 박 찾기는 곡 한가운데서 잣대를 바꾸기도 한다 — 그러면 마디 길이가
   * 들쭉날쭉해져 진행 바가 갑자기 느려진다. 「박 고르기」가 그 자리를
   * 메우거나 덜어 낸다. 8분음표를 박으로 세어 마디가 절반이 된 곡은
   * 「마디 ×2」로 바로잡는다 — 어느 쪽이 옳은지는 악보를 봐야 안다.
   */
  const beatFix = async (mode: "even" | "half" | "double") => {
    setBusy(true);
    setError(null);
    try {
      onResult(await fixBeats(result.id, mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : "고치지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 지금 맞춘 연주설정을 이 곡의 기준값으로 적어 둔다.
   *
   * 싱크는 기기 사정이 아니라 악보와 음원이 어긋난 정도다 — 강사님이
   * 한 번 맞추면 수강생 모두에게 같은 값이 옳다. 곡에 적어 두면 곡
   * 파일에 실려 함께 가고, 기기를 바꾸거나 재분석해도 남는다.
   */
  const keepSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      onResult(await putSongSetup(result.id, loadSetup(result.id)));
      setKept(true);
      setTimeout(() => setKept(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "적어 두지 못했습니다");
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
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] roomy:text-[13px]">
      {score && align ? (
        <>
          <span className="text-[var(--foreground)]">
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
        <span className="flex items-center gap-1 text-[var(--foreground)]">
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
                className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
                disabled={busy || !online}
                onClick={() => void fitBars()}
                title="코드가 바뀌는 자리에 마디선을 맞춥니다(한 마디 안에서)"
              >
                자동 맞추기
              </button>
              <button
                className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
                disabled={busy || !online}
                onClick={() => void readMarks()}
                title="AI에게 다시 읽힙니다"
              >
                다시 읽기
              </button>
            </>
          ) : (
            <>
              <span className="text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                · 시작 {sheet.offset > 0 ? "+" : ""}
                {sheet.offset}마디
              </span>
              <button
                className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
                disabled={busy || !online}
                onClick={() => void move(sheet.offset - 1, sheet.repeats)}
                title="악보를 한 마디 앞으로"
              >
                ◀
              </button>
              <button
                className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
                disabled={busy || !online}
                onClick={() => void move(sheet.offset + 1, sheet.repeats)}
                title="악보를 한 마디 뒤로"
              >
                ▶
              </button>
              <button
                className="rounded bg-[var(--chip)] px-1.5 py-0.5 font-semibold disabled:opacity-40"
                disabled={busy || !online}
                onClick={() => void fitBars()}
                title="코드가 바뀌는 자리에 마디선을 맞춥니다(한 마디 안에서)"
              >
                자동 맞추기
              </button>
              <button
                className="rounded bg-[var(--chip)] px-1.5 py-0.5 font-semibold disabled:opacity-40"
                disabled={busy || !online}
                onClick={() => void readMarks()}
                title="도돌이표·1·2번 괄호·D.S.를 AI가 읽어 부르는 차례를 폅니다"
              >
                AI로 되돌이 읽기
              </button>
              <select
                className="rounded bg-[var(--chip)] px-1 py-0.5"
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

      {beatUnit > 0 && (
        <span className="flex items-center gap-1 text-[var(--foreground)]">
          · 마디 {(beatUnit * 4).toFixed(2)}초
          {wobble > 0 && (
            <span className="text-amber-600" title="이 자리에서 진행 바가 튑니다">
              (들쭉날쭉 {wobble}곳)
            </span>
          )}
          {wobble > 0 && (
            <button
              className="rounded bg-amber-200/70 px-1.5 py-0.5 font-semibold disabled:opacity-40 dark:bg-amber-800/60"
              disabled={busy || !online}
              onClick={() => void beatFix("even")}
              title="벌어진 곳에 박을 끼워 넣고 좁은 곳은 덜어 마디를 고르게 합니다"
            >
              박 고르기
            </button>
          )}
          <button
            className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => void beatFix("half")}
            title="8분음표를 박으로 세어 마디가 절반이 된 곡. 마디를 두 배 길게 봅니다"
          >
            마디 ×2
          </button>
          <button
            className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => void beatFix("double")}
            title="마디가 악보보다 두 배 길 때. 마디를 절반으로 봅니다"
          >
            마디 ÷2
          </button>
        </span>
      )}

      <span className="ml-auto flex shrink-0 gap-1.5">
        <button
          className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => pickImage.current?.click()}
          title="인쇄된 악보를 그대로 띄우고 그 위로 커서가 지나갑니다"
        >
          {sheet ? "그림 바꾸기" : "악보 그림 붙이기"}
        </button>
        {sheet && (
          <button
            className="rounded px-2 py-0.5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={detachImage}
          >
            그림 떼기
          </button>
        )}
        {/* 지금 맞춘 싱크·카포를 이 곡의 기준값으로. 곡 파일에 실려
            수강생에게도 같은 값이 간다 */}
        <button
          className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => void keepSetup()}
          title="지금 싱크·카포·주법을 이 곡의 기준으로 적어 둡니다. 수강생도 같은 값으로 시작합니다"
        >
          {kept ? "적어 두었습니다" : "기준값 저장"}
        </button>
        <button
          className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => pick.current?.click()}
          title={online ? "" : "분석 서버에 연결되어야 붙일 수 있습니다"}
        >
          {busy ? "붙이는 중…" : score ? "악보 바꾸기" : "악보 붙이기"}
        </button>
        {score && (
          <button
            className="rounded px-2 py-0.5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2 disabled:opacity-40"
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
