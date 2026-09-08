"use client";

import { useRef, useState } from "react";

import { putResult, putTabImage, readSheetTabAi } from "@/lib/api";
import type { AnalysisResult } from "@/lib/types";

/**
 * 인쇄된 타브 악보(PDF) 읽어 붙이기 — 강사님 화면에만 나온다.
 *
 * 악보 그림 붙이기와 다르다. 저쪽은 그림을 그대로 띄우고 그 위로 커서가
 * 지나갈 뿐이지만, 이쪽은 **프렛 숫자를 읽어 우리 타브에 다시 그린다** —
 * 코드에서 만들어 낸 운지 대신 편곡자가 짚으라고 적은 자리가 나온다.
 *
 * 손잡이는 타브 화면에 둔다. 결과가 나오는 자리에서 붙이고 밀어야,
 * 자리가 맞는지 보면서 손볼 수 있다.
 */
export function TabAttach({
  result,
  onResult,
  online,
}: {
  result: AnalysisResult;
  onResult: (r: AnalysisResult) => void;
  online: boolean;
}) {
  const pick = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tab = result.picked_tab;

  const attach = async (file: File) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const next = await putTabImage(result.id, file);
      onResult(next);
      const t = next.picked_tab;
      if (t) {
        const strum = t.measures.filter((m) => m.kind === "strum").length;
        setNote(
          `타브 ${t.measures.length}마디를 읽었습니다` +
            (strum ? ` (훑는 마디 ${strum})` : "") +
            ". 자리가 밀리면 「◀ 타브 · 타브 ▶」로 맞추세요.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "타브를 읽지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 붙여 둔 악보 그림의 타브를 AI에게 읽힌다.
   *
   * 자로 재어 읽는 길은 인쇄가 또렷한 악보라야 한다 — 스캔이 흐리거나
   * 줄이 기울면 여섯 줄을 못 찾는다. 그럴 때 쓴다.
   */
  const readByAi = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const got = await readSheetTabAi(result.id);
      onResult(got.result);
      setNote(`AI가 ${got.bars}마디 가운데 ${got.read}마디를 읽었습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "읽지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  /** 결과를 통째로 적는다. 기기와 서버 양쪽이 같은 값을 갖게 한다 */
  const write = async (next: AnalysisResult, fail: string) => {
    setBusy(true);
    setError(null);
    try {
      await putResult(next);
      onResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : fail);
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    if (!confirm("읽어 둔 타브를 뗍니다. 계속할까요?")) return;
    setNote(null);
    await write({ ...result, picked_tab: null }, "떼지 못했습니다");
  };

  /** 악보 첫 마디가 음원 몇 번째 마디인지. 전주 길이가 다르면 통째로 민다 */
  const shift = async (by: number) => {
    if (!tab) return;
    await write(
      {
        ...result,
        picked_tab: { ...tab, bar_offset: (tab.bar_offset ?? 0) + by },
      },
      "밀지 못했습니다",
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1 text-[11px]">
      <button
        className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40"
        disabled={busy || !online}
        onClick={() => pick.current?.click()}
        title={
          online
            ? "인쇄된 타브 악보(PDF)의 프렛 숫자를 읽어 이 화면에 그립니다"
            : "분석 서버에 연결되어야 읽을 수 있습니다"
        }
      >
        {busy
          ? "읽는 중…"
          : tab
            ? `타브 바꾸기 (${tab.measures.length}마디)`
            : "타브 읽어 붙이기"}
      </button>
      {/* 붙여 둔 악보 그림에서 AI로 읽는다. 자로 재는 길이 안 될 때 쓴다 */}
      <button
        className="rounded bg-[var(--chip)] px-2 py-0.5 disabled:opacity-40"
        disabled={busy || !online}
        onClick={() => void readByAi()}
        title="붙여 둔 악보 그림(PDF·사진)에 그려진 타브를 AI가 눈으로 읽습니다. 자로 재어 읽는 길이 안 될 때 쓰세요"
      >
        AI로 타브 읽기
      </button>
      {tab && (
        <>
          {/* 전주 길이가 악보와 다르면 숫자가 통째로 밀린다 */}
          <button
            className="rounded bg-[var(--chip)] px-2 py-0.5 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => void shift(-1)}
            title="타브를 한 마디 앞으로"
          >
            ◀ 타브
          </button>
          <span className="text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            {tab.bar_offset ?? 0}
          </span>
          <button
            className="rounded bg-[var(--chip)] px-2 py-0.5 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => void shift(1)}
            title="타브를 한 마디 뒤로"
          >
            타브 ▶
          </button>
          <button
            className="rounded px-2 py-0.5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={detach}
          >
            타브 떼기
          </button>
        </>
      )}
      {note && <span className="text-green-700 dark:text-green-400">{note}</span>}
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      <input
        ref={pick}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void attach(file);
        }}
      />
    </div>
  );
}
