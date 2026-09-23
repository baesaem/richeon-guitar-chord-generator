"use client";

import { useRef, useState } from "react";

import {
  dropScore,
  dropSheetImage,
  fitSheetImage,
  fixBeats,
  moveSheetImage,
  putResult,
  readSheetImage,
  putSheetImage,
} from "@/lib/api";
import type { ScoreAlign, ScoreData } from "@/lib/scoreStaff";
import type { AnalysisResult } from "@/lib/types";
import { msczParts, type MsczPart } from "@/lib/msczToAbc";
import { attachScoreAfterAnalysis, type AttachProgress } from "@/lib/scoreAtRegister";
import { Popup } from "@/components/Popup";
import { Working } from "@/components/Working";
import { AskConfirm } from "@/components/Ask";
import { melodyIndex } from "@/components/ScorePick";

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
  onScoreAttached,
  onReadChords,
  readNeedsFile = true,
}: {
  result: AnalysisResult;
  onResult: (r: AnalysisResult) => void;
  online: boolean;
  /** 악보를 붙여 ABC까지 새로 만들었을 때. 화면이 그 악보를 다시 읽는다 */
  onScoreAttached?: () => void;
  /**
   * 그림 악보에서 **코드 이름만** 읽어 이 곡의 악보에 적어 넣는다.
   *
   * 악보 파일의 음표는 그대로 두고 코드만 종이 것으로 바꾸고 싶을 때가
   * 있다 — 옮겨 적은 사람이 달라 코드가 어긋나는 일이 잦다.
   */
  onReadChords?: (file?: File) => void | Promise<void>;
  /** 코드를 읽을 그림을 새로 골라야 하나. 아니면 붙여 둔 배경악보에서 읽는다 */
  readNeedsFile?: boolean;
}) {
  const pick = useRef<HTMLInputElement | null>(null);
  const pickChords = useRef<HTMLInputElement | null>(null);
  const pickImage = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
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
  const beatFix = async (
    mode: "even" | "half" | "double" | "third" | "triple",
  ) => {
    setBusy(true);
    setError(null);
    try {
      // 기기에만 있는 곡은 서버가 모른다 — 기기 사본을 먼저 보낸다
      await putResult(result);
      onResult(await fixBeats(result.id, mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : "고치지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 마디선을 한 박 앞(-1)·뒤(+1)로 옮긴다 — 박의 시각은 그대로, 마디·박 번호만.
   *
   * 못갖춘마디로 시작하는 곡은 첫 박이 넷째 박이다. 박 찾기가 그 박을 1마디
   * 첫 박으로 세면, 악보 커서와 코드가 곡 내내 한 마디 늦는다(「하얀 나비」).
   * 앞 박들은 1마디(못갖춘마디)가 되고 그 뒤를 넷씩 다시 센다. 기기에 적고
   * 서버가 있으면 서버에도 보낸다.
   */
  const shiftDownbeat = async (dir: -1 | 1) => {
    const per = parseInt(String(result.time_signature || "4/4"), 10) || 4;
    const beats = [...result.beats].sort((a, b) => a.t - b.t);
    if (beats.length < per * 2) return;
    // 지금 첫 마디 첫 박 앞에 몇 박이 있는가(못갖춘마디의 박 수)
    const first = beats.findIndex((b) => b.beat === 1);
    const lead = (((first < 0 ? 0 : first) + dir) % per + per) % per;
    const next: AnalysisResult = {
      ...result,
      beats: beats.map((b, i) => {
        if (i < lead) return { ...b, bar: 1, beat: per - lead + i + 1 };
        const j = i - lead;
        return { ...b, bar: (lead ? 2 : 1) + Math.floor(j / per), beat: (j % per) + 1 };
      }),
    };
    setBusy(true);
    setError(null);
    try {
      if (online) await putResult(next).catch(() => {});
      onResult(next);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 악보를 붙인다 — 등록 때와 똑같은 길로.
   *
   * 예전에는 서버에 악보만 실었다. 그러면 멜로디 화면은 바뀌는데 코드는
   * 그대로여서, 코드를 악보에 맞추려면 음원을 다시 등록하는 수밖에
   * 없었다. 악보를 붙이는 일과 코드가 그 악보를 따르는 일은 하나다.
   */
  /** 악보 붙이기 진행 — 기다리는 동안 작업 중 화면에 단계·진행 막대로 보인다 */
  const [attaching, setAttaching] = useState<AttachProgress | null>(null);
  const attach = async (file: File, staff = 0) => {
    setBusy(true);
    setError(null);
    try {
      const { result: next, notes } = await attachScoreAfterAnalysis(
        result,
        file,
        staff,
        setAttaching,
      );
      onResult(next);
      onScoreAttached?.();
      if (notes.length) setError(notes.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "악보를 붙이지 못했습니다");
    } finally {
      setBusy(false);
      setAttaching(null);
    }
  };

  /**
   * 혼성 악보(노래·기타·타브가 한 파일)면 어느 보표를 쓸지 묻는다.
   * 파일만 봐서는 어느 것이 멜로디인지 모른다 — 사람이 고른다.
   */
  const [askPart, setAskPart] = useState<{ file: File; parts: MsczPart[] } | null>(null);
  const pickScore = async (file: File) => {
    if (/\.(mscz|mscx)$/i.test(file.name)) {
      try {
        const parts = msczParts(new Uint8Array(await file.arrayBuffer()), file.name);
        if (parts.length > 1) {
          setAskPart({ file, parts });
          return;
        }
      } catch {
        // 목록을 못 뽑으면 첫 보표로 붙인다 — 서버가 다시 읽는다
      }
    }
    await attach(file);
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

  /* 지우기 확인창. 시스템 confirm()은 이 앱을 여는 환경(미리보기 창·폰
     웹앱)에서 막혀 곧바로 「취소」가 되어, 눌러도 아무 일이 없었다 */
  const [asking, setAsking] = useState<"image" | "score" | null>(null);

  const detachImage = async () => {
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
      {attaching && (
        <Working
          label="악보를 붙이는 중"
          note={attaching.note}
          steps={attaching.steps}
          stepIndex={attaching.index}
          stepDone={attaching.done}
          stepTotal={attaching.total}
          expectSec={attaching.expectSec}
        />
      )}
      {asking && (
        <AskConfirm
          title={asking === "image" ? "배경악보 제거" : "악보전체 제거"}
          message={
            asking === "image"
              ? "붙여 둔 배경악보를 지웁니다. 계속할까요?"
              : "붙여 둔 악보를 통째로 지웁니다. 계속할까요?"
          }
          confirmLabel="지우기"
          danger
          onConfirm={() => void (asking === "image" ? detachImage() : detach())}
          onClose={() => setAsking(null)}
        />
      )}
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
          {/* 슬로우 록(12비트)은 한 박을 셋으로 쪼개 친다. 박 찾기가 그
              셋잇단을 저마다 박으로 세면 마디가 세 배로 늘어나는데, 두
              배로는 나눠떨어지지 않아 「마디 ×2」로는 영영 맞출 수 없다 */}
          <button
            className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => void beatFix("third")}
            title="슬로우 록(12비트)처럼 셋잇단을 박으로 세어 마디가 3분의 1이 된 곡. 마디를 세 배 길게 봅니다"
          >
            마디 ×3
          </button>
          <button
            className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => void beatFix("triple")}
            title="마디가 악보보다 세 배 길 때. 마디를 3분의 1로 봅니다"
          >
            마디 ÷3
          </button>
          {/* 마디선을 한 박씩 — 못갖춘마디(여린내기)로 시작하는 곡을 첫 박부터
              넷씩 세면 악보 커서가 한 마디 늦는다(「하얀 나비」). 박 시각은 그대로 */}
          <span className="flex items-center gap-0.5">
            마디선
            <button
              className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
              disabled={busy}
              onClick={() => void shiftDownbeat(-1)}
              title="마디선을 한 박 앞으로 — 마디 첫 박이 한 박 일찍 옵니다"
            >
              ◀ 한 박
            </button>
            <button
              className="rounded bg-[var(--chip)] px-1.5 py-0.5 disabled:opacity-40"
              disabled={busy}
              onClick={() => void shiftDownbeat(1)}
              title="마디선을 한 박 뒤로 — 첫 박이 못갖춘마디(여린내기)인데 1마디 첫 박으로 세어져 악보 커서가 한 마디 늦을 때"
            >
              한 박 ▶
            </button>
          </span>
        </span>
      )}

      <span className="ml-auto flex shrink-0 gap-1.5">
        <button
          className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => pickImage.current?.click()}
          title="인쇄된 악보를 그대로 띄우고 그 위로 커서가 지나갑니다"
        >
          {sheet ? "배경악보 바꾸기" : "배경악보 붙이기"}
        </button>
        {sheet && (
          <button
            className="rounded px-2 py-0.5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => setAsking("image")}
          >
            배경악보 제거
          </button>
        )}
        <button
          className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40 roomy:px-3 roomy:py-1"
          disabled={busy || !online}
          onClick={() => pick.current?.click()}
          title={
            online
              ? "악보 파일(.mscz·MusicXML)이나 종이 악보(PDF·사진)를 붙여 음표·가사·코드·마디를 통째로 바꿉니다. PDF는 코드 읽기와 음표 읽기로 2분쯤 걸립니다"
              : "분석 서버에 연결되어야 붙일 수 있습니다"
          }
        >
          {busy ? "붙이는 중…" : score ? "악보전체 바꾸기" : "악보전체 붙이기"}
        </button>
        {onReadChords && (
          <button
            className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40 roomy:px-3 roomy:py-1"
            disabled={busy || !online}
            onClick={() => {
              if (readNeedsFile) {
                pickChords.current?.click();
                return;
              }
              // 붙여 둔 배경악보에서 읽는다 — 새로 고를 것이 없다
              setBusy(true);
              setError(null);
              Promise.resolve(onReadChords())
                .catch((err) =>
                  setError(err instanceof Error ? err.message : "읽지 못했습니다"),
                )
                .finally(() => setBusy(false));
            }}
            title="그림 악보(PDF·사진)를 골라 넣으면 AI가 거기 적힌 코드 이름을 읽어 이 곡의 악보에 적습니다. 음표와 가사는 그대로 둡니다"
          >
            {busy ? "읽는 중… (1분쯤)" : "코드만 바꾸기(AI)"}
          </button>
        )}
        {score && (
          <button
            className="rounded px-2 py-0.5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => setAsking("score")}
          >
            악보전체 제거
          </button>
        )}
      </span>

      {error && <span className="w-full text-red-600">{error}</span>}

      <input
        ref={pickChords}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !onReadChords) return;
          setBusy(true);
          setError(null);
          Promise.resolve(onReadChords(file))
            .catch((err) =>
              setError(err instanceof Error ? err.message : "읽지 못했습니다"),
            )
            .finally(() => setBusy(false));
        }}
      />
      <input
        ref={pick}
        type="file"
        /* 종이 악보(PDF·사진)도 받는다 — 코드는 AI가, 음표는 서버 OMR이 읽어 합친다
           (scoreAtRegister). 이미 등록한 곡도 다시 등록하지 않고 붙일 수 있게 */
        accept=".mscz,.mscx,.musicxml,.mxl,.xml,.pdf,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void pickScore(file);
        }}
      />
      {askPart && (
        <Popup title="어느 보표를 쓸까요" width="max-w-xs" onClose={() => setAskPart(null)}>
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            혼성 악보입니다. 멜로디·가사·코드를 읽을 보표를 고르세요. 멜로디는
            보통 가사가 붙은 보표이고, 타브는 멜로디가 아닙니다.
          </p>
          <div className="space-y-1.5">
            {/* 가사가 가장 많은 보표를 권한다 — 이름만으로는 모를 때가 많다
                (「잊혀지는 것」은 세 보표가 모두 「어쿠스틱 기타」였다) */}
            {askPart.parts.map((p) => {
              const best = p.index === melodyIndex(askPart.parts);
              return (
                <button
                  key={p.index}
                  className={
                    best
                      ? "w-full rounded bg-[var(--accent)] px-2 py-2.5 text-sm font-semibold text-white"
                      : "w-full rounded border border-[color-mix(in_srgb,var(--foreground)_35%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] px-2 py-2.5 text-sm text-[var(--foreground)]"
                  }
                  onClick={() => {
                    const f = askPart.file;
                    setAskPart(null);
                    void attach(f, p.index);
                  }}
                >
                  {p.name}
                  {best ? " (추천)" : ""}
                </button>
              );
            })}
          </div>
        </Popup>
      )}
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
