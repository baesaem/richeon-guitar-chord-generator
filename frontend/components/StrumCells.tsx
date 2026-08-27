"use client";

import type { StrumPattern } from "@/lib/strumLibrary";

/**
 * 스트로크 패턴 화살표 + 악센트 표시.
 *
 * 악센트 칸은 강조색·볼드 — 같은 화살표라도 어디를 세게 긋는지에 따라
 * 리듬이 달라지므로, 패턴을 보여주는 곳마다 이 표기를 같이 쓴다.
 */
export function StrumCells({
  pattern,
  className,
}: {
  pattern: StrumPattern;
  className?: string;
}) {
  const cells = pattern.cells.trimEnd().split("");
  const accents = pattern.accents ?? "";
  return (
    <span className={["font-mono tracking-wide", className ?? ""].join(" ")}>
      {cells.map((c, i) => {
        const mark = c === "D" ? "↓" : c === "U" ? "↑" : "·";
        const accented = accents[i] === ">";
        return (
          <span
            key={i}
            className={accented ? "font-bold text-[var(--accent)]" : undefined}
          >
            {mark}
            {i % 2 === 1 && i < cells.length - 1 ? " " : ""}
          </span>
        );
      })}
    </span>
  );
}
