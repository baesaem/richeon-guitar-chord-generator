"use client";

import { useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { Copyright } from "@/components/Copyright";
import { spell } from "@/lib/notation";
import { voicingFor } from "@/lib/voicings";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * 코드 사전.
 *
 * 지금 인식 가능한 어휘(장·단3화음 24개)를 전부 보여준다.
 * M4에서 7th·sus가 붙으면 여기에 그대로 추가된다.
 */
export function ChordsTab() {
  const [flats, setFlats] = useState(false);
  const [quality, setQuality] = useState<"maj" | "min">("maj");

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">코드리스트</h2>
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => setFlats((f) => !f)}
        >
          {flats ? "♭ 표기" : "♯ 표기"}
        </button>
      </div>

      <div className="mb-3 flex gap-1.5">
        {(["maj", "min"] as const).map((q) => (
          <button
            key={q}
            onClick={() => setQuality(q)}
            className={[
              "flex-1 rounded py-2 text-sm",
              q === quality
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-gray-100 dark:bg-gray-800",
            ].join(" ")}
          >
            {q === "maj" ? "메이저" : "마이너"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {ROOTS.map((root) => {
          const label = spell(quality === "min" ? `${root}m` : root, flats);
          return (
            <div key={root} className="flex flex-col items-center">
              <div className="text-sm font-bold">{label}</div>
              <ChordDiagram voicing={voicingFor(root, quality)} label={label} width={100} />
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-gray-400">
        오픈 코드 8개는 표준 운지를 쓰고, 나머지는 E폼·A폼 바레를 해당 프렛으로 옮겨
        만듭니다. 점 안의 숫자는 손가락 번호입니다(1 검지 … 4 새끼).
      </p>

      <Copyright />
    </div>
  );
}
