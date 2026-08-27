"use client";

import { Fretboard } from "@/components/Fretboard";

/**
 * 지판과 음정 — 기타반 유인물 4장 「지판과 음정」을 옮긴 것.
 *
 * 지판표(어느 자리가 무슨 음인지)만 있으면 왜 그런지는 모른다. 유인물이
 * 설명하는 규칙 — 한 칸은 반음, E–F와 B–C만 반음 사이, 12프렛에서 한
 * 옥타브 — 을 표 위에 함께 둔다.
 */

const STRINGS = [
  { no: 6, name: "E (미)", note: "가장 굵은 줄 · 가장 낮은 소리" },
  { no: 5, name: "A (라)", note: "" },
  { no: 4, name: "D (레)", note: "" },
  { no: 3, name: "G (솔)", note: "" },
  { no: 2, name: "B (시)", note: "" },
  { no: 1, name: "E (미)", note: "가장 가는 줄 · 가장 높은 소리" },
];

const SOLFEGE = [
  ["도", "C"], ["레", "D"], ["미", "E"], ["파", "F"],
  ["솔", "G"], ["라", "A"], ["시", "B"],
] as const;

export function FretPrimer() {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">줄과 프렛</h3>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        지판에는 프렛(쇠막대)이 박혀 있어 음을 나눕니다. 아무것도 누르지
        않으면 0프렛(개방현), 한 칸씩 잡을수록 1프렛·2프렛…입니다. 굵은
        줄부터 6번 → 1번이고, 굵을수록 낮은 소리가 납니다.
      </p>
      <ul className="mb-3 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
        {STRINGS.map((s) => (
          <li key={s.no} className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="w-10 shrink-0 text-xs font-bold">{s.no}번줄</span>
            <span className="w-14 shrink-0 text-sm font-medium">{s.name}</span>
            <span className="min-w-0 flex-1 text-[11px] text-gray-500">{s.note}</span>
          </li>
        ))}
      </ul>

      <h3 className="mb-1 text-sm font-semibold">계이름과 알파벳</h3>
      <div className="mb-3 grid grid-cols-7 gap-1 text-center">
        {SOLFEGE.map(([ko, en]) => (
          <div
            key={en}
            className="rounded border border-gray-200 py-1.5 dark:border-gray-700"
          >
            <div className="text-[11px] text-gray-500">{ko}</div>
            <div className="text-sm font-bold">{en}</div>
          </div>
        ))}
      </div>

      <h3 className="mb-1 text-sm font-semibold">반음과 온음</h3>
      <p className="mb-3 text-[11px] leading-snug text-gray-500">
        지판 한 칸이 반음, 두 칸이 온음입니다. <b>E–F와 B–C 사이만
        반음</b>이고 나머지 이웃 음은 모두 온음 — 그래서 한 옥타브 안에 음이
        12개입니다. 같은 줄에서 12프렛은 개방현과 같은 음이고 한 옥타브
        높습니다. 0~11프렛의 음이 12프렛부터 다시 시작됩니다.
      </p>

      <h3 className="mb-1 text-sm font-semibold">지판표</h3>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        어느 자리가 무슨 음인지. 옆으로 밀어 15프렛까지 볼 수 있습니다.
      </p>
      <Fretboard />
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        온음만 적었습니다. 반음(♯·♭)은 온음 사이의 한 칸입니다 — 예를 들어
        C와 D 사이가 C♯(D♭)입니다. 흐린 칸은 실제 기타 지판의 점 위치입니다.
      </p>
    </div>
  );
}
