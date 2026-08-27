"use client";

import { spellKey } from "@/lib/notation";
import { render, type StrumChoice } from "@/lib/strumLibrary";

/**
 * 곡 안내줄 — 조성·박자·스트로크·연주설정.
 *
 * 코드악보와 파형이 같은 줄을 쓴다. 두 화면은 같은 곡을 다르게 보여줄
 * 뿐이라, 곡의 성격은 어느 쪽에서 보든 같은 자리에 있어야 한다.
 */
export function SongInfoLine({
  musicKey,
  timeSignature,
  strum,
  playNotes,
  onPickStrum,
  right,
  children,
}: {
  musicKey: string;
  timeSignature: string;
  /** 이 곡에 어울리는 스트로크. 없으면 자리를 비운다 */
  strum?: StrumChoice | null;
  /** 연주설정에서 바꾼 것들(카포·빠르기 등) */
  playNotes?: string[];
  onPickStrum?: () => void;
  /** 줄 오른쪽 끝(악보보기 버튼 등) */
  right?: React.ReactNode;
  /** right 앞에 놓을 것(줄 번호 등) */
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      {/* 곡 정보는 한 줄에 둔다. 두 줄로 접히면 그 아래 악보가 통째로
          밀려 내려가, 한 화면에 보이던 마디가 사라진다. 넘치면 옆으로
          밀어 본다. */}
      <div
        className="flex items-center gap-x-2 overflow-x-auto whitespace-nowrap text-[11px] text-gray-500 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
      {/* 「조성」·「박자」라고 적지 않는다. 자리가 정해져 있어 값만 봐도
          무엇인지 안다. 한 줄에 담아야 해서 한 글자가 아깝다. */}
      <span className="shrink-0">
        {spellKey(musicKey) || "조성 미상"} · {timeSignature}
      </span>
      {/* 이 곡에 어울리는 스트로크. 눌러서 다른 패턴으로 바꾼다 */}
      {strum && (
        <button
          className="shrink-0 text-gray-700 underline decoration-dotted underline-offset-2 dark:text-gray-300"
          onClick={onPickStrum}
          title={`${strum.why} · ${strum.pattern.hint}`}
        >
          <span className="font-mono tracking-wide">{render(strum.pattern.cells)}</span>
          <span className="ml-1 text-gray-400">{strum.pattern.name}</span>
        </button>
      )}
      {playNotes?.map((note) => (
        <span key={note} className="shrink-0 text-[var(--accent)]">
          {note}
        </span>
      ))}
      {/* 진행 줄수도 같은 줄 오른쪽 끝에. 자리가 남으면 밀려가 붙고,
          모자라면 뒤에 이어져 옆으로 밀어 볼 수 있다 */}
      {children && (
        <span className="ml-auto shrink-0 pl-2 tabular-nums">{children}</span>
      )}
      </div>

      {/* 악보보기만 아래 줄에. 글자 사이에 버튼이 끼면 읽는 흐름이 끊긴다 */}
      {right && <div className="flex justify-end">{right}</div>}
    </div>
  );
}
