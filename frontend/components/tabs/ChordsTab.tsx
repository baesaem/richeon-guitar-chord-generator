"use client";

import { useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { Copyright } from "@/components/Copyright";
import { labelFor } from "@/lib/notation";
import { voicingFor } from "@/lib/voicings";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 운지 폼이 있는 종류만 노출한다
const QUALITIES: { value: string; label: string }[] = [
  { value: "maj", label: "메이저" },
  { value: "min", label: "마이너" },
  { value: "7", label: "7" },
  { value: "maj7", label: "maj7" },
  { value: "min7", label: "m7" },
  { value: "sus4", label: "sus4" },
  { value: "sus2", label: "sus2" },
  { value: "dim", label: "dim" },
];

/**
 * 코드 사전.
 *
 * 인식 가능한 어휘 중 운지 폼이 있는 종류를 근음 12개씩 보여준다.
 * M4부터 백엔드가 7th·sus·dim까지 내므로 여기도 같이 넓어졌다.
 */
export function ChordsTab() {
  const [flats, setFlats] = useState(false);
  const [quality, setQuality] = useState("maj");

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

      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {QUALITIES.map((q) => (
          <button
            key={q.value}
            onClick={() => setQuality(q.value)}
            className={[
              "rounded py-2 text-sm",
              q.value === quality
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-gray-100 dark:bg-gray-800",
            ].join(" ")}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {ROOTS.map((root) => {
          const label = labelFor(root, quality, flats);
          return (
            <div key={root} className="flex flex-col items-center">
              <div className="text-sm font-bold"><ChordLabel label={label} /></div>
              <ChordDiagram
                voicing={voicingFor(root, quality)}
                label={label}
                width={100}
              />
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-gray-400">
        장·단3화음 오픈 코드는 표준 운지를 쓰고, 나머지는 E폼·A폼 바레를 해당
        프렛으로 옮겨 만듭니다. 점 안의 숫자는 손가락 번호입니다(1 검지 … 4 새끼).
      </p>

      <Copyright />
    </div>
  );
}
