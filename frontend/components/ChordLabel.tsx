import type { ReactNode } from "react";

/**
 * 코드 라벨 표시.
 *
 * ♭·♯ 임시표를 위첨자로 올려 실제 악보처럼 보이게 한다.
 * 문자열 자체는 notation.spell()이 이미 기호로 바꿔 준 상태다.
 */
export function ChordLabel({ label }: { label: string }) {
  /* 숫자(7·9·5·add9의 9)는 작게 적는다. 뿌리음과 같은 크기면 E7이 「E」와
     「7」 두 코드처럼 읽히고, 칸이 좁은 그리드에서는 뿌리음이 밀려 잘린다.
     ♭·♯은 조금 올려 작게 — 악보에 적는 방식 그대로다 */
  const parts = label.split(/([♭♯]|\d+)/).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part === "♭" || part === "♯" ? (
          <sup key={i} className="text-[0.62em] leading-none">
            {part}
          </sup>
        ) : /^\d+$/.test(part) ? (
          <span key={i} className="text-[0.72em]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}


/**
 * SVG 글자용 코드 이름. <text> 안에 넣는다.
 *
 * 규칙은 ChordLabel과 같다 — ♭·♯은 조금 올려 작게, 숫자는 작게. 오선
 * 악보·타브처럼 SVG로 그리는 화면도 그리드와 같은 모양이어야 한다.
 */
export function chordLabelSvg(label: string): ReactNode {
  return label
    .split(/([♭♯]|\d+)/)
    .filter(Boolean)
    .map((part, i) =>
      part === "♭" || part === "♯" ? (
        <tspan key={i} dy="-0.35em" fontSize="70%">
          {part}
          <tspan dy="0.5em" fontSize="1">
            {" "}
          </tspan>
        </tspan>
      ) : /^\d+$/.test(part) ? (
        <tspan key={i} fontSize="75%">
          {part}
        </tspan>
      ) : (
        <tspan key={i}>{part}</tspan>
      ),
    );
}
