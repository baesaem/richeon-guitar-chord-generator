"use client";

/**
 * 아르페지오 — 기타반 유인물 「아르페지오 모음 1·2」를 옮긴 것.
 *
 * 패턴 번호와 손가락 순서, 어느 곡에 쓰는지는 유인물(과 선생님 필기)을
 * 그대로 따른다. 수업에서 부르는 이름과 앱이 다르면 서로 못 알아본다.
 *
 * 유인물은 엄지를 T, 약지를 r로 적지만 세계 공통 표기는 p·i·m·a다.
 * 여기서는 표준 표기로 적고 대응표를 함께 둔다.
 */

/** 뜯는 손가락 이름. 유인물 아래쪽 손 그림의 표기 그대로 */
const FINGERS = [
  { pima: "p", cls: "T", es: "pulgar", en: "thumb", ko: "엄지" },
  { pima: "i", cls: "i", es: "indice", en: "index", ko: "검지" },
  { pima: "m", cls: "m", es: "medio", en: "middle", ko: "중지" },
  { pima: "a", cls: "r", es: "anular", en: "ring", ko: "약지" },
];

/** 엄지(p)가 짚는 줄. 코드의 근음이 있는 줄이다 */
const BASS_RULE = [
  { chords: "C · A", string: "5번줄" },
  { chords: "G · E · F", string: "6번줄" },
  { chords: "D", string: "4번줄" },
];

interface Pattern {
  no: number;
  /** 유인물의 보기 코드 */
  chord: string;
  /** 한 마디의 손가락 순서. 8분음표 8칸 기준 */
  seq: string[];
  /** 선생님 필기 — 이 패턴을 쓰는 곡 */
  songs: string;
  note?: string;
}

const PATTERNS: Pattern[] = [
  {
    no: 1, chord: "Am", seq: ["p", "i", "m", "i", "a", "i", "m", "i"],
    songs: "정녕 그대를 · 모두가 사랑이에요",
    note: "제일 많이 쓰는 패턴",
  },
  {
    no: 2, chord: "C", seq: ["p", "i", "m", "i", "a", "m", "i", "m"],
    songs: "바위섬",
  },
  {
    no: 3, chord: "C", seq: ["p", "i", "m", "i", "p", "i", "m", "i"],
    songs: "J에게 · 이젠 사랑할 수 있어요 · 그대 먼 곳에",
  },
  {
    no: 4, chord: "C", seq: ["p", "m", "i", "a", "m", "i", "a", "m"],
    songs: "친구 · 행복한 사람",
  },
  {
    no: 5, chord: "Am → E7", seq: ["p", "i", "m", "a", "p", "i", "m", "a"],
    songs: "사랑으로 · 촛불",
  },
  {
    no: 6, chord: "Dm", seq: ["p", "i", "m", "a", "i", "m", "a", "m"],
    songs: "정녕 그대를",
  },
  {
    no: 7, chord: "Dm", seq: [],
    songs: "새벽기차",
    note: "두 줄을 함께 뜯는 변형 — 유인물의 타브 악보를 그대로 따라 치세요",
  },
  {
    no: 8, chord: "Dm", seq: ["p", "i", "m", "i", "p", "i", "m", "i"],
    songs: "옛 시인의 노래",
    note: "표시된 박에서 약지(a)를 함께 뜯습니다",
  },
];

export function ArpeggioGuide() {
  return (
    <div>
      <p className="mb-3 text-[11px] leading-snug text-gray-500">
        아르페지오는 코드를 한 번에 긁지 않고 한 줄씩 나눠 뜯는 주법입니다.
        기타반 유인물 「아르페지오 모음 1·2」의 패턴과 곡 배정을 그대로
        옮겼습니다.
      </p>

      <h3 className="mb-1 text-sm font-semibold">뜯는 손가락</h3>
      <div className="mb-1.5 overflow-x-auto">
        <table className="w-full min-w-[300px] text-center text-xs">
          <thead>
            <tr className="text-[10px] text-gray-400">
              <th className="py-1 font-normal">표기</th>
              <th className="font-normal">유인물</th>
              <th className="font-normal">손가락</th>
              <th className="font-normal">스페인어</th>
              <th className="font-normal">영어</th>
            </tr>
          </thead>
          <tbody>
            {FINGERS.map((f) => (
              <tr key={f.pima} className="border-t border-gray-200 dark:border-gray-800">
                <td className="py-1.5 font-mono text-sm font-bold text-[var(--accent)]">
                  {f.pima}
                </td>
                <td className="font-mono">{f.cls}</td>
                <td className="font-medium">{f.ko}</td>
                <td className="text-gray-500">{f.es}</td>
                <td className="text-gray-500">{f.en}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-3 text-[10px] leading-snug text-gray-400">
        새끼손가락은 쓰지 않습니다. 유인물의 T는 p(엄지), r은 a(약지)와 같은
        표기입니다.
      </p>

      <h3 className="mb-1 text-sm font-semibold">엄지(p)가 짚는 줄</h3>
      <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
        엄지는 코드의 근음(가장 낮은 음)이 있는 줄을 뜯습니다.
      </p>
      <div className="mb-3 flex gap-1.5">
        {BASS_RULE.map((r) => (
          <div
            key={r.string}
            className="flex-1 rounded border border-gray-200 py-1.5 text-center dark:border-gray-700"
          >
            <div className="text-sm font-bold">{r.chords}</div>
            <div className="text-[11px] text-gray-500">{r.string}</div>
          </div>
        ))}
      </div>

      <h3 className="mb-1.5 text-sm font-semibold">패턴 1–8</h3>
      <ul className="space-y-2">
        {PATTERNS.map((p) => (
          <li
            key={p.no}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-sm font-bold">패턴 {p.no}</span>
              <span className="text-[11px] text-gray-500">보기 코드 {p.chord}</span>
            </div>
            {p.seq.length > 0 && (
              <div className="mb-1 flex gap-1">
                {p.seq.map((f, i) => (
                  <span
                    key={i}
                    className={[
                      "flex h-7 flex-1 items-center justify-center rounded font-mono text-sm font-bold",
                      f === "p"
                        ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]"
                        : "bg-gray-100 dark:bg-gray-800",
                    ].join(" ")}
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            {p.note && (
              <p className="text-[11px] leading-snug text-gray-500">{p.note}</p>
            )}
            <p className="text-[11px] text-[var(--accent)]">♪ {p.songs}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-gray-400">
        한 칸이 8분음표 하나입니다(4/4 한 마디 = 8칸). 색이 든 칸이 엄지(p) —
        마디의 근음 자리입니다.
      </p>
    </div>
  );
}
