"use client";

import { useState } from "react";

import { Popup } from "@/components/Popup";
import { StrumCells } from "@/components/StrumCells";
import { PATTERNS, type StrumChoice } from "@/lib/strumLibrary";

/**
 * 스트로크 패턴 고르기 창. 아르페지오 고르기와 같은 방식 —
 * 곡에 맞는 패턴을 이유와 함께 추천하고, 짚어 보고, 확정한다.
 *
 * 「자동 추천」을 고르면 곡이 바뀔 때마다 앱이 알아서 고른 패턴을
 * 따라간다. 직접 고르면 그 패턴이 곡에 붙어 다닌다.
 */
export function StrumPickModal({
  current,
  rec,
  onPick,
  onClose,
}: {
  /** 직접 골라 둔 패턴 이름. 빈 문자열이면 자동 추천 상태 */
  current: string;
  /** 이 곡의 자동 추천(이유 포함) */
  rec: StrumChoice;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(current);
  const picked = name ? PATTERNS.find((p) => p.name === name) ?? null : null;

  return (
    <Popup title="스트로크 패턴" width="max-w-xs" onClose={onClose}>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        <button
          className="font-semibold text-[var(--accent)] underline"
          onClick={() => setName("")}
        >
          이 곡 추천: {rec.pattern.name}
        </button>{" "}
        — {rec.why}. 직접 고르지 않으면 추천을 따릅니다.{" "}
        <b className="text-[var(--accent)]">색이 든 화살표</b>가 크게 긋는
        악센트입니다.
      </p>

      <ul className="space-y-1">
        {PATTERNS.map((p) => {
          const active = name === p.name || (!name && p.name === rec.pattern.name);
          return (
            <li key={p.name}>
              <button
                className={[
                  "w-full rounded border px-2.5 py-1.5 text-left",
                  active
                    ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]"
                    : "border-gray-200 dark:border-gray-700",
                ].join(" ")}
                onClick={() => setName(p.name)}
              >
                <div className="flex items-baseline gap-2">
                  <StrumCells pattern={p} className="text-sm" />
                  <span className="text-xs font-medium">{p.name}</span>
                  {p.name === rec.pattern.name && (
                    <span className="ml-auto rounded bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-1 py-0.5 text-[10px] text-[var(--accent)]">
                      추천
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
                  {p.hint}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        className="mt-2.5 w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
        onClick={() => {
          onPick(picked ? picked.name : "");
          onClose();
        }}
      >
        {picked ? `「${picked.name}」로 연주` : "자동 추천으로 연주"}
      </button>
    </Popup>
  );
}
