"use client";

import { ChordDiagram } from "@/components/ChordDiagram";
import { voicingFor } from "@/lib/voicings";

/**
 * 운지 확인용 페이지 (/diagrams).
 *
 * 코드 어휘가 늘어날 때(M4의 7th·sus 등) 새 폼이 제대로 그려지는지
 * 한 화면에서 눈으로 확인하는 용도.
 */
const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export default function Diagrams() {
  return (
    <main className="p-4">
      {(["maj", "min"] as const).map((quality) => (
        <section key={quality} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">
            {quality === "maj" ? "장3화음" : "단3화음"}
          </h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {ROOTS.map((root) => {
              const label = quality === "min" ? `${root}m` : root;
              return (
                <div key={label} className="text-center">
                  <div className="text-sm font-bold">{label}</div>
                  <ChordDiagram
                    voicing={voicingFor(root, quality)}
                    label={label}
                    width={100}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
