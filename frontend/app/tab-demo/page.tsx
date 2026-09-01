"use client";

import { useEffect, useState } from "react";

/**
 * 그림 타브 붙이기 — 시험 화면.
 *
 * 인쇄된 타브 악보(PDF)를 자로 재어 읽은 결과를 앱의 여섯 줄 타브로 그린다.
 * 읽는 쪽은 backend/app/tab_image.py 가 맡고, 여기서는 그 결과만 그린다.
 * 뜯는 마디는 프렛 숫자를, 훑는 마디는 코드 한 벌과 손 방향(∏·∨)을 보인다.
 */

type Col = Record<string, number>;
type Bar =
  | { no: number; kind: "pick"; cols: Col[] }
  | { no: number; kind: "strum"; chord: Col; strokes: string };
type Tab = { title: string; artist: string; source: string; measures: Bar[] };

const PER_LINE = 4;
const PAD_X = 6;
const VB_W = 400;
const TOP = 20;          // 여섯 줄 첫 줄
const GAP = 7;           // 줄 사이
const STAFF_H = GAP * 5;
const ROW_H = TOP + STAFF_H + 12;

export default function TabDemo() {
  const [tab, setTab] = useState<Tab | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/demo/baram-tab.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then(setTab)
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  if (err) return <p className="p-6 text-sm">읽지 못했습니다: {err}</p>;
  if (!tab) return <p className="p-6 text-sm">불러오는 중…</p>;

  const lines: Bar[][] = [];
  for (let i = 0; i < tab.measures.length; i += PER_LINE)
    lines.push(tab.measures.slice(i, i + PER_LINE));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-[var(--foreground)]">
      <h1 className="text-lg font-bold">
        {tab.title} <span className="text-sm font-normal opacity-70">{tab.artist}</span>
      </h1>
      <p className="mt-1 text-xs opacity-60">
        {tab.source} 를 자로 재어 읽었습니다 · 마디 {tab.measures.length}개
      </p>

      <div className="mt-4 space-y-1 rounded-lg border border-[var(--panel-line)] bg-[var(--panel)] p-3">
        {lines.map((line, li) => (
          <StaffLine key={li} line={line} per={PER_LINE} />
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed opacity-60">
        숫자는 짚을 프렛, 맨 윗줄이 1번 줄입니다. 훑는 마디는 코드 한 벌을 앞에
        두고, 칠 자리마다 손 방향을 ↓(내려긋기) · ↑(올려긋기)로 적었습니다. 음표 길이는
        옮기지 않고 한 마디 안에 고르게 벌려 놓았습니다.
      </p>
    </main>
  );
}

function StaffLine({ line, per }: { line: Bar[]; per: number }) {
  const measureW = (VB_W - PAD_X * 2) / per;

  return (
    <svg viewBox={`0 0 ${VB_W} ${ROW_H}`} className="w-full" role="img"
      aria-label={`${line[0].no}마디부터`}>
      {/* 여섯 줄. 맨 아래(6번줄)는 굵은 줄이라 살짝 두껍게 */}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={PAD_X} x2={VB_W - PAD_X}
          y1={TOP + i * GAP} y2={TOP + i * GAP}
          stroke="currentColor" strokeWidth={i === 5 ? 0.7 : 0.45} opacity={0.5} />
      ))}

      {line.map((bar, i) => {
        const x0 = PAD_X + i * measureW;
        const inner = measureW - 8;
        const slots = bar.kind === "pick"
          ? Math.max(1, bar.cols.length)
          : Math.max(1, bar.strokes.length);
        const step = inner / slots;
        const at = (n: number) => x0 + 4 + step * (n + 0.5);

        return (
          <g key={bar.no}>
            {/* 마디선 */}
            <line x1={x0} x2={x0} y1={TOP} y2={TOP + STAFF_H}
              stroke="currentColor" strokeWidth={0.5} opacity={0.55} />
            <text x={x0 + 1.5} y={TOP - 4} fontSize={5} fill="currentColor" opacity={0.5}>
              {bar.no}
            </text>

            {bar.kind === "pick"
              ? bar.cols.map((col, ci) =>
                  Object.entries(col).map(([s, f]) => (
                    <Fret key={`${ci}-${s}`} x={at(ci)} s={Number(s)} f={f} />
                  )),
                )
              : (
                <>
                  {/* 첫머리에 잡을 코드 한 벌 */}
                  {Object.entries(bar.chord).map(([s, f]) => (
                    <Fret key={s} x={x0 + 4.5} s={Number(s)} f={f} />
                  ))}
                  {/* 훑는 자리마다 손 방향 화살표를 여섯 줄 한가운데에.
                      아래에 따로 줄을 두면 눈이 위아래로 오가야 해서,
                      칠 자리와 방향을 한자리에서 보게 모았다. 빗금은
                      화살표가 대신하므로 그리지 않는다. */}
                  {bar.strokes.split("").map((d, si) => (
                    <g key={si}>
                      <rect x={at(si) - 3.2} y={TOP + GAP * 2.5 - 4.6}
                        width={6.4} height={9.2} fill="var(--panel)" />
                      <text x={at(si)} y={TOP + GAP * 2.5 + 3.4} fontSize={9.5}
                        textAnchor="middle" fill="currentColor" fontWeight={700}
                        stroke="currentColor" strokeWidth={0.35}>
                        {d === "D" ? "↓" : "↑"}
                      </text>
                    </g>
                  ))}
                </>
              )}
          </g>
        );
      })}
      {/* 줄 끝 마디선 */}
      <line x1={VB_W - PAD_X} x2={VB_W - PAD_X} y1={TOP} y2={TOP + STAFF_H}
        stroke="currentColor" strokeWidth={0.5} opacity={0.55} />
    </svg>
  );
}

/** 프렛 숫자 한 개. 줄 위에 앉고, 줄이 글자를 가리지 않게 바탕을 판다 */
function Fret({ x, s, f }: { x: number; s: number; f: number }) {
  const y = TOP + (s - 1) * GAP;
  return (
    <>
      <rect x={x - 2.4} y={y - 2.6} width={4.8} height={5.2}
        fill="var(--panel)" />
      <text x={x} y={y + 1.9} fontSize={5.6} textAnchor="middle"
        fill="currentColor" fontWeight={600}>
        {f}
      </text>
    </>
  );
}
