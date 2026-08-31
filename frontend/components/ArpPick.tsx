"use client";

import { useState } from "react";

import { ArpPatternTab } from "@/components/ArpeggioGuide";
import { Popup } from "@/components/Popup";
import { ARP_PATTERNS, arpPattern, suggestArp } from "@/lib/arpeggio";

/**
 * 아르페지오 패턴 고르기 창.
 *
 * 연주설정에 번호 칩을 늘어놓는 대신, 「아르페지오」를 누르면 이 창이
 * 뜬다. 곡의 박자·빠르기로 패턴 하나를 추천하고(이유와 함께), 어떤
 * 번호를 짚어도 운지 타브를 먼저 보여준다 — 번호만 보고 고르면 어떤
 * 소리가 나는 패턴인지 알 수 없다.
 */
export function ArpPickModal({
  current,
  timeSignature,
  bpm,
  onPick,
  onClose,
}: {
  /** 지금 걸려 있는 패턴 번호. 0이면 아직 없음 */
  current: number;
  timeSignature: string;
  bpm: number;
  onPick: (no: number) => void;
  onClose: () => void;
}) {
  const rec = suggestArp(timeSignature, bpm);
  const [no, setNo] = useState(current > 0 ? current : rec.no);
  const p = arpPattern(no);

  return (
    <Popup title="아르페지오 패턴" width="max-w-xs" onClose={onClose}>
      <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        <button
          className="font-semibold text-[var(--accent)] underline"
          onClick={() => setNo(rec.no)}
        >
          이 곡 추천: 패턴 {rec.no}
        </button>{" "}
        — {rec.why}
      </p>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {ARP_PATTERNS.map((q) => (
          <button
            key={q.no}
            onClick={() => setNo(q.no)}
            className={[
              "rounded py-1 text-xs",
              q.no === no
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-[var(--panel)]",
              q.no === rec.no && q.no !== no
                ? "ring-1 ring-[var(--accent)]"
                : "",
            ].join(" ")}
          >
            {q.no}
          </button>
        ))}
      </div>

      {p && (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-sm font-bold">패턴 {p.no}</span>
            <span className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
              보기 코드 {p.chords.join(" → ")}
            </span>
            {p.no === rec.no && (
              <span className="rounded bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent)]">
                추천
              </span>
            )}
          </div>
          <ArpPatternTab chords={p.chords} seq={p.seq} />
          {p.note && (
            <p className="text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">{p.note}</p>
          )}
          <p className="text-[11px] text-[var(--accent)]">♪ {p.songs}</p>
          <button
            className="mt-2.5 w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
            onClick={() => {
              onPick(p.no);
              onClose();
            }}
          >
            이 패턴으로 연주
          </button>
        </>
      )}
    </Popup>
  );
}
