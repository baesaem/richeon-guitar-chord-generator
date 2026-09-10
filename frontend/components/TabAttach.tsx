"use client";

import { useRef, useState } from "react";

import { AskConfirm } from "@/components/Ask";
import { putResult, putTabImage, readSheetTabAi } from "@/lib/api";
import type { AnalysisResult, PickedTab } from "@/lib/types";

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
  onFillTab,
}: {
  result: AnalysisResult;
  onResult: (r: AnalysisResult) => void;
  online: boolean;
  /**
   * 읽은 그림 타브의 숫자를 악보 마디에 얹는다.
   *
   * 읽자마자 부른다 — 읽어 두기만 하고 넣지 않으면 화면이 그대로라
   * 「안 읽혔다」로 보인다. 갓 읽은 것을 함께 넘긴다(상태는 아직 옛 것이다).
   */
  onFillTab?: (picked?: PickedTab) => void;
}) {
  const pick = useRef<HTMLInputElement | null>(null);
  const pickAi = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* 「타브 떼기」 확인창. 시스템 confirm()은 이 앱을 여는 환경(미리보기
     창·폰 웹앱)에서 막혀 곧바로 「취소」가 되어, 눌러도 아무 일이 없었다 */
  const [asking, setAsking] = useState(false);
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
        onFillTab?.(t);
        const strum = t.measures.filter((m) => m.kind === "strum").length;
        setNote(
          `타브 ${t.measures.length}마디를 읽었습니다` +
            (strum ? ` (훑는 마디 ${strum})` : "") +
            ". 「읽은 타브를 악보에 넣기」를 누르면 악보에 얹힙니다.",
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
  const readByAi = async (file: File) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const got = await readSheetTabAi(result.id, file);
      onResult(got.result);
      if (got.result.picked_tab) onFillTab?.(got.result.picked_tab);
      setNote(
        `AI가 ${got.bars}마디 가운데 숫자 ${got.read}마디, 코드 ${got.chordBars}마디를 읽었습니다.`,
      );
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
    setNote(null);
    await write({ ...result, picked_tab: null }, "떼지 못했습니다");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1 text-[11px]">
      <button
        className="rounded bg-[var(--chip)] px-2 py-0.5 font-semibold text-[var(--foreground)] disabled:opacity-40"
        disabled={busy || !online}
        onClick={() => pick.current?.click()}
        title={
          online
            ? "인쇄된 타브 악보(PDF)의 프렛 숫자를 읽어 이 곡에 담아 둡니다. 악보 파일이 붙은 곡은 그 뒤 「악보에 넣기」를 눌러야 화면이 바뀝니다"
            : "분석 서버에 연결되어야 읽을 수 있습니다"
        }
      >
        {busy
          ? "읽는 중…"
          : tab
            ? `그림 타브 다시 읽기 (${tab.measures.length}마디)`
            : "그림에서 타브 읽기"}
      </button>
      {/* 붙여 둔 악보 그림에서 AI로 읽는다. 자로 재는 길이 안 될 때 쓴다 */}
      <button
        className="rounded bg-[var(--chip)] px-2 py-0.5 disabled:opacity-40"
        disabled={busy || !online}
        onClick={() => pickAi.current?.click()}
        title="그림 악보(PDF·사진)를 골라 넣으면 AI가 숫자와 코드 이름을 한 번에 읽습니다. 자로 재어 읽어 둔 숫자가 있으면 그대로 두고 못 읽은 마디와 코드만 채웁니다"
      >
        AI로 그림 읽기 (숫자·코드·가사)
      </button>
      {tab && (
        <>
          <button
            className="rounded px-2 py-0.5 text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline decoration-dotted underline-offset-2 disabled:opacity-40"
            disabled={busy || !online}
            onClick={() => setAsking(true)}
          >
            타브 떼기
          </button>
        </>
      )}
      {asking && (
        <AskConfirm
          title="타브 떼기"
          message="읽어 둔 타브를 뗍니다. 계속할까요?"
          confirmLabel="떼기"
          danger
          onConfirm={() => void detach()}
          onClose={() => setAsking(false)}
        />
      )}
      {note && <span className="text-green-700 dark:text-green-400">{note}</span>}
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      <input
        ref={pickAi}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void readByAi(file);
        }}
      />
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
