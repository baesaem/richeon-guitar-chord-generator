"use client";

import { useRef, useState } from "react";

import { msczParts, type MsczPart } from "@/lib/msczToAbc";
import { SCORE_ACCEPT } from "@/lib/scoreAtRegister";

/**
 * 분석과 함께 넣을 악보 고르기 — 음원등록과 음원교체가 같이 쓴다.
 *
 * 음원만 듣고 딴 코드는 틀리는 데가 많다. 악보를 함께 넣으면 분석이
 * 끝나는 자리에서 붙이고, 마디 수를 맞추고, 코드가 악보를 따르게 한다.
 *
 * 혼성 악보(노래·기타·타브가 한 파일)면 어느 보표가 멜로디인지 파일만
 * 봐서는 모르므로 고르는 칸을 함께 낸다.
 */
export function ScorePick({
  score,
  staff,
  onPick,
}: {
  score: File | null;
  staff: number;
  /** 고른 악보와 보표. 뺐으면 file이 null */
  onPick: (file: File | null, staff: number) => void;
}) {
  const pick = useRef<HTMLInputElement | null>(null);
  const [parts, setParts] = useState<MsczPart[]>([]);

  const choose = async (f: File) => {
    if (!/\.(mscz|mscx)$/i.test(f.name)) {
      setParts([]);
      onPick(f, 0);
      return;
    }
    try {
      const list = msczParts(new Uint8Array(await f.arrayBuffer()), f.name);
      setParts(list);
      // 타브가 아닌 첫 보표를 기본으로 — 타브는 멜로디가 아니다
      const first = list.findIndex((p) => !/타브/.test(p.name));
      onPick(f, first >= 0 ? first : 0);
    } catch {
      setParts([]);
      onPick(f, 0);
    }
  };

  return (
    <>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <button
          className="shrink-0 rounded bg-[var(--chip)] px-2 py-1.5 font-semibold text-[var(--foreground)]"
          onClick={() => pick.current?.click()}
          title="뮤즈스코어(.mscz)·ABC 악보나 종이 악보(PDF·사진)를 넣으면 코드를 악보대로 적고, 마디 수도 악보에 맞춥니다"
        >
          {score ? "악보 바꾸기" : "악보 함께 넣기 (선택)"}
        </button>
        <span className="min-w-0 flex-1 truncate text-[color-mix(in_srgb,var(--foreground)_60%,transparent)]">
          {score ? score.name : "없으면 음원만 듣고 코드를 땁니다"}
        </span>
        {score && (
          <button
            className="shrink-0 underline decoration-dotted"
            onClick={() => {
              setParts([]);
              onPick(null, 0);
            }}
          >
            빼기
          </button>
        )}
        <input
          ref={pick}
          type="file"
          accept={SCORE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void choose(f);
          }}
        />
      </div>
      {parts.length > 1 && (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="shrink-0">멜로디 보표</span>
          <select
            className="min-w-0 flex-1 rounded border bg-[var(--background)] px-2 py-1.5"
            value={staff}
            onChange={(e) => onPick(score, +e.target.value)}
            title="혼성 악보입니다. 코드·가사·멜로디를 읽을 보표를 고르세요"
          >
            {parts.map((p) => (
              <option key={p.index} value={p.index}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
