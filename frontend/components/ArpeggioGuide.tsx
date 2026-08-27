"use client";

/**
 * 아르페지오 — 기타반 유인물 「아르페지오 모음 1·2」를 옮긴 것.
 *
 * 패턴 데이터는 lib/arpeggio.ts 에 있다. 코드 악보의 아르페지오 타브와
 * 같은 원본을 써야 배우는 것과 치는 것이 어긋나지 않는다.
 *
 * 패턴은 글자 나열이 아니라 유인물처럼 **타브 악보**로 그린다. 여섯 줄
 * 위에 프렛 숫자가 놓여야 어느 줄을 뜯는지 눈으로 바로 보인다.
 *
 * 유인물은 엄지를 T, 약지를 r로 적지만 세계 공통 표기는 p·i·m·a다.
 * 여기서는 표준 표기로 적고 대응만 각주로 남긴다.
 */

import { ARP_PATTERNS, arpString, exampleVoicing } from "@/lib/arpeggio";

/** 뜯는 손가락 이름. 유인물 아래쪽 손 그림의 표기 그대로 */
const FINGERS = [
  { pima: "p", es: "pulgar", en: "thumb", ko: "엄지" },
  { pima: "i", es: "indice", en: "index", ko: "검지" },
  { pima: "m", es: "medio", en: "middle", ko: "중지" },
  { pima: "a", es: "anular", en: "ring", ko: "약지" },
];

/** 엄지(p)가 짚는 줄. 코드의 근음이 있는 줄이다 */
const BASS_RULE = [
  { chords: "C · A", string: "5번줄" },
  { chords: "G · E · F", string: "6번줄" },
  { chords: "D", string: "4번줄" },
];

/**
 * 패턴 한 마디의 타브 악보.
 *
 * 여섯 줄(맨 위가 1번줄) 위에 프렛 숫자를 동그라미로 얹는다. 숫자에 배경을
 * 깔지 않고 칩으로 얹는 건 테마(밝게/어둡게)마다 바탕색이 달라서다.
 */
export function ArpPatternTab({ chords, seq }: { chords: string[]; seq: string[][] }) {
  const two = chords.length === 2;
  const LBL = 18; // 줄 번호 자리
  const COL = 36; // 8분음표 한 칸
  const TOP = two ? 24 : 12;
  const GAP = 13;
  const W = LBL + COL * seq.length + 4;
  const FY = TOP + GAP * 5 + 17; // 손가락 글자 줄
  const H = FY + 4;
  const y = (s: number) => TOP + (s - 1) * GAP;
  const cx = (k: number) => LBL + COL * k + COL / 2;
  const chordAt = (k: number) => chords[two && k >= seq.length / 2 ? 1 : 0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {two &&
        chords.map((c, i) => (
          <text
            key={`${c}${i}`}
            x={cx(i * (seq.length / 2))}
            y={12}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill="currentColor"
          >
            {c}
          </text>
        ))}
      {[1, 2, 3, 4, 5, 6].map((s) => (
        <g key={s}>
          <text
            x={LBL - 6}
            y={y(s) + 2.8}
            textAnchor="end"
            fontSize={7.5}
            fill="currentColor"
            opacity={0.45}
          >
            {s}
          </text>
          {/* 6번줄은 굵은 줄 — 지판과 음정 페이지와 같은 감각 */}
          <line
            x1={LBL}
            x2={W - 2}
            y1={y(s)}
            y2={y(s)}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={s === 6 ? 1.6 : 1}
          />
        </g>
      ))}
      {seq.map((fs, k) => (
        <g key={k}>
          {fs.map((f) => {
            const voicing = exampleVoicing(chordAt(k));
            const str = voicing ? arpString(f, voicing) : null;
            if (!voicing || str === null) return null;
            const fret = voicing.frets[6 - str];
            return (
              <g key={f}>
                <circle
                  cx={cx(k)}
                  cy={y(str)}
                  r={7}
                  fill={f === "p" ? "var(--accent)" : "#6b7280"}
                />
                <text
                  x={cx(k)}
                  y={y(str) + 3.2}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={700}
                  fill="#fff"
                >
                  {fret}
                </text>
              </g>
            );
          })}
          <text
            x={cx(k)}
            y={FY}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fontFamily="ui-monospace, monospace"
            fill={fs.includes("p") ? "var(--accent)" : "currentColor"}
            opacity={fs.includes("p") ? 1 : 0.6}
          >
            {fs.join("")}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ArpeggioGuide() {
  return (
    <div>
      <p className="mb-3 text-[11px] leading-snug text-gray-500">
        아르페지오는 코드를 한 번에 긁지 않고 한 줄씩 나눠 뜯는 주법입니다.
        기타반 유인물 「아르페지오 모음 1·2」의 패턴과 곡 배정을 그대로
        옮기고, 유인물 밖의 표준 패턴을 뒤에 더했습니다. 연주설정의
        「주법」에서 패턴을 고르면 코드 악보가 그 패턴의 타브로 그려집니다.
      </p>

      <h3 className="mb-1 text-sm font-semibold">뜯는 손가락</h3>
      <div className="mb-1.5 overflow-x-auto">
        <table className="w-full min-w-[260px] text-center text-xs">
          <thead>
            <tr className="text-[10px] text-gray-400">
              <th className="py-1 font-normal">표기</th>
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
        엄지는 코드의 근음(가장 낮은 음)이 있는 줄을 뜯습니다. 나머지는
        검지 3번줄 · 중지 2번줄 · 약지 1번줄이 기본입니다.
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

      <h3 className="mb-1.5 text-sm font-semibold">패턴</h3>
      <ul className="space-y-2">
        {ARP_PATTERNS.map((p) => (
          <li
            key={p.no}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-sm font-bold">패턴 {p.no}</span>
              <span className="text-[11px] text-gray-500">
                보기 코드 {p.chords.join(" → ")}
              </span>
              {p.extra && (
                <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800">
                  표준 추가
                </span>
              )}
            </div>
            <ArpPatternTab chords={p.chords} seq={p.seq} />
            {p.note && (
              <p className="text-[11px] leading-snug text-gray-500">{p.note}</p>
            )}
            <p className="text-[11px] text-[var(--accent)]">♪ {p.songs}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-gray-400">
        여섯 줄이 기타 줄이고 맨 위가 1번줄(가는 줄)입니다. 숫자는 누르는
        프렛(0=개방현), 한 칸이 8분음표 하나(4/4 한 마디 = 8칸)입니다. 색이
        든 음이 엄지(p)가 뜯는 근음입니다.
      </p>
    </div>
  );
}
