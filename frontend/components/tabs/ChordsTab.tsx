"use client";

import { useState } from "react";

import { ChordDiagram } from "@/components/ChordDiagram";
import { ChordLabel } from "@/components/ChordLabel";
import { Copyright } from "@/components/Copyright";
import { Fretboard } from "@/components/Fretboard";
import { labelFor } from "@/lib/notation";
import { voicingFor } from "@/lib/voicings";

const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * 종류. 이름은 기타반에서 나눠 주는 코드표를 그대로 따른다 —
 * 「메이저 세븐스 코드(M7)」처럼 부르던 것을 앱에서 maj7이라고만 적어 두면
 * 같은 것인지 알아보기 어렵다.
 *
 * 앞의 여섯은 코드표에 있는 것이고, 뒤의 둘은 곡에 나오면 잡아야 해서
 * 함께 둔다.
 */
const QUALITIES: { value: string; label: string; full: string }[] = [
  { value: "maj", label: "M", full: "메이저" },
  { value: "min", label: "m", full: "마이너" },
  { value: "7", label: "7", full: "세븐스" },
  { value: "maj7", label: "M7", full: "메이저 세븐스" },
  { value: "min7", label: "m7", full: "마이너 세븐스" },
  { value: "sus4", label: "Sus4", full: "서스포" },
  { value: "sus2", label: "Sus2", full: "서스투" },
  { value: "dim", label: "dim", full: "디미니시" },
];

/** 검은건반 음의 두 가지 표기. 코드표처럼 둘 다 보여준다 */
const BOTH: Record<string, string> = {
  "C#": "C♯(D♭)", "D#": "D♯(E♭)", "F#": "F♯(G♭)",
  "G#": "G♯(A♭)", "A#": "A♯(B♭)",
};

/**
 * 코드 사전.
 *
 * 인식 가능한 어휘 중 운지 폼이 있는 종류를 근음 12개씩 보여준다.
 * M4부터 백엔드가 7th·sus·dim까지 내므로 여기도 같이 넓어졌다.
 */
export function ChordsTab() {
  const [flats, setFlats] = useState(false);
  const [quality, setQuality] = useState("maj");
  const picked = QUALITIES.find((q) => q.value === quality) ?? QUALITIES[0];

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">코드표</h2>
        <button
          className="rounded border px-2 py-1 text-xs"
          onClick={() => setFlats((f) => !f)}
        >
          {flats ? "♭ 표기" : "♯ 표기"}
        </button>
      </div>

      <div className="mb-1.5 grid grid-cols-4 gap-1.5">
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
      <p className="mb-3 text-[11px] text-gray-500">
        {picked.full} 코드 ({picked.label})
      </p>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {ROOTS.map((root) => {
          const label = labelFor(root, quality, flats);
          return (
            <div key={root} className="flex flex-col items-center">
              {/* 검은건반은 두 이름을 함께 적는다. 악보마다 표기가 달라
                  C♯로 적힌 곡과 D♭로 적힌 곡이 같은 자리라는 것을 알아야 한다 */}
              <div className="text-center text-[11px] leading-none text-gray-400">
                {BOTH[root] ?? " "}
              </div>
              <div className="text-sm font-bold">
                <ChordLabel label={label} />
              </div>
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
        점 안의 숫자는 손가락 번호입니다(1 검지 · 2 중지 · 3 약지 · 4 새끼).
        ○는 개방현, ×는 소리 내지 않는 줄입니다. 오픈 코드는 표준 운지를 쓰고,
        나머지는 E폼·A폼 바레를 해당 프렛으로 옮겨 만듭니다.
      </p>

      <h2 className="mb-1 mt-6 text-lg font-bold">지판표</h2>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        어느 자리가 무슨 음인지. 코드 모양만 외우면 아는 코드 밖으로 못
        나갑니다. 옆으로 밀어 15프렛까지 볼 수 있습니다.
      </p>
      <Fretboard />
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        온음만 적었습니다. 반음(♯·♭)은 온음 사이의 한 칸입니다 — 예를 들어
        C와 D 사이가 C♯(D♭)입니다. 흐린 칸은 실제 기타 지판의 점 위치입니다.
      </p>

      <Copyright />
    </div>
  );
}
