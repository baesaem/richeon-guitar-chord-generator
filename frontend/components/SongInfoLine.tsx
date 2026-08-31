"use client";

import { StrumCells } from "@/components/StrumCells";
import { spellKey } from "@/lib/notation";
import type { StrumChoice } from "@/lib/strumLibrary";

/**
 * 곡 안내줄 — 조성·박자·스트로크·연주설정.
 *
 * 코드악보와 파형이 같은 줄을 쓴다. 두 화면은 같은 곡을 다르게 보여줄
 * 뿐이라, 곡의 성격은 어느 쪽에서 보든 같은 자리에 있어야 한다.
 */
export function SongInfoLine({
  musicKey,
  timeSignature,
  playStyle,
  strum,
  playNotes,
  onPickStrum,
  right,
  children,
}: {
  musicKey: string;
  timeSignature: string;
  /** 이 곡을 치는 방식 — 「스트로크」 또는 「아르페지오 3」 */
  playStyle?: string;
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
    /* 곡 정보와 전체보기 버튼을 한 줄에 둔다. 두 줄로 접히면 그 아래
       악보가 통째로 밀려 내려가, 한 화면에 보이던 마디가 사라진다.
       버튼은 스크롤 밖에 고정 — 정보가 길면 정보만 옆으로 밀어 본다. */
    /* 스크롤 밖에 붙여 둔다 — 싱크·마디 조절이 이 줄에 있는데, 악보를
       내리다 보면 줄이 위로 사라져 조절할 수가 없었다. 스크롤이 없는
       화면(재생 화면)에서는 sticky가 아무 일도 하지 않는다. */
    <div className="sticky top-0 z-10 flex items-center gap-x-1.5 bg-[var(--background)] py-1 text-[11px] text-gray-500 roomy:gap-x-2.5 roomy:text-[14px]">
      <div
        className="flex min-w-0 flex-1 items-center gap-x-2 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {/* 「조성」·「박자」라고 적지 않는다. 자리가 정해져 있어 값만 봐도
            무엇인지 안다. 한 줄에 담아야 해서 한 글자가 아깝다. */}
        <span className="shrink-0">
          {spellKey(musicKey) || "조성 미상"} · {timeSignature}
        </span>
        {/* 스트로크인지 아르페지오인지. 조성·박자와 나란히 — 곡의 성격을
            읽는 자리가 한군데여야 어느 화면에서도 같은 곳을 본다 */}
        {playStyle && (
          <span className="shrink-0 text-[14px] font-bold text-gray-800 roomy:text-[17px] dark:text-gray-100">
            {playStyle}
          </span>
        )}
        {/* 이 곡에 어울리는 스트로크. 눌러서 다른 패턴으로 바꾼다 */}
        {strum && (
          <button
            className="shrink-0 text-gray-700 underline decoration-dotted underline-offset-2 dark:text-gray-300"
            onClick={onPickStrum}
            title={`${strum.why} · ${strum.pattern.hint}`}
          >
            <StrumCells pattern={strum.pattern} />
            <span className="ml-1 text-gray-400">{strum.pattern.name}</span>
          </button>
        )}
        {playNotes?.map((note) => (
          <span key={note} className="shrink-0 text-[var(--accent)]">
            {note}
          </span>
        ))}
      </div>
      {/* 조절 단추는 스크롤 밖에 둔다. 안에 두면 곡 정보가 길 때 밀려나
          잘린다 — 눌러야 하는 것이 먼저 사라지면 안 된다. */}
      {children && <span className="shrink-0">{children}</span>}
      {right && <span className="shrink-0">{right}</span>}
    </div>
  );
}
