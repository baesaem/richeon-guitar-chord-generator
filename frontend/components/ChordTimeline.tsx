"use client";

import { useEffect, useRef } from "react";

import type { Bar } from "@/lib/bars";
import { labelFor, transposeRoot } from "@/lib/notation";

interface Props {
  bars: Bar[];
  currentBar: number;
  flats: boolean;
  /** 이조 반음 수. 하단 「음높이」 설정과 연동된다 */
  transpose: number;
  follow: boolean;
}

/**
 * 마디 그리드.
 *
 * 폰 세로 화면 기준으로 한 줄에 4마디. 재생 중인 마디를 화면 가운데로 따라간다.
 */
export function ChordTimeline({ bars, currentBar, flats, transpose, follow }: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!follow) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentBar, follow]);

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {bars.map((bar, i) => {
        const active = i === currentBar;
        return (
          <div
            key={bar.number}
            ref={active ? activeRef : undefined}
            className={[
              "flex min-h-14 flex-col justify-center rounded border px-1 py-1.5 text-center",
              active
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-gray-200 dark:border-gray-700",
            ].join(" ")}
          >
            <div className="flex flex-wrap items-center justify-center gap-x-1 leading-tight">
              {bar.chords.length === 0 ? (
                <span className="text-sm opacity-40">·</span>
              ) : (
                bar.chords.map((c, j) => (
                  <span
                    key={j}
                    className={
                      bar.chords.length > 1 ? "text-sm font-semibold" : "text-lg font-bold"
                    }
                  >
                    {labelFor(transposeRoot(c.root, transpose), c.quality, flats)}
                  </span>
                ))
              )}
            </div>
            <div className="text-[10px] opacity-40">{bar.number}</div>
          </div>
        );
      })}
    </div>
  );
}
