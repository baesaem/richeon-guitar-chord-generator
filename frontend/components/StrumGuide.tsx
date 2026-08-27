"use client";

import { StrumCells } from "@/components/StrumCells";
import { PATTERNS } from "@/lib/strumLibrary";

/**
 * 스트로크 — 기본 이론, 표준 패턴, 연습 방법.
 *
 * 패턴 목록은 연주설정의 고르기 창과 같은 원본(strumLibrary)을 쓴다.
 * 배우는 것과 연주설정에서 고르는 것이 같은 이름·같은 표기여야 한다.
 */

const BASICS = [
  {
    title: "다운(↓)과 업(↑)",
    body: "다운은 6번줄에서 1번줄 쪽으로 쓸어내리고, 업은 반대로 쓸어올립니다. 업은 여섯 줄을 다 긁지 않고 아래 서너 줄만 가볍게 스칩니다.",
  },
  {
    title: "손은 시계추처럼",
    body: "손목 힘을 빼고 8분음표마다 아래·위로 꾸준히 흔듭니다. 치지 않는 칸(·)에서도 손은 허공에서 계속 움직입니다 — 이 헛스윙이 박자를 지켜 줍니다.",
  },
  {
    title: "악센트(강세)",
    body: "패턴표에서 색이 든 화살표가 크게 긋는 칸입니다. 같은 화살표라도 어디를 세게 치는지에 따라 리듬이 완전히 달라집니다 — 고고는 2·4박을 세게 쳐야 고고답게 들립니다.",
  },
  {
    title: "피크와 팔",
    body: "피크는 엄지·검지로 가볍게, 끝이 3~4mm만 나오게 잡습니다. 팔꿈치가 아니라 손목으로 긋고, 줄에 너무 깊이 넣지 않습니다.",
  },
];

const PRACTICE = [
  "왼손으로 줄을 살짝 덮어 음을 죽인 채(뮤트) 패턴의 리듬만 칩니다. 손이 리듬을 외울 때까지.",
  "코드 하나(G나 Em)로 패턴을 반복합니다. 느린 빠르기에서 시작해 조금씩 올립니다 — 4비트부터 시작해도 좋습니다.",
  "두 코드(G↔C)를 오가며 칩니다. 마디 마지막 업스트로크를 치는 동안 왼손이 다음 코드로 미리 이동합니다.",
  "곡에 붙입니다. 연주설정의 「스트로크」에서 패턴을 고르면 악보 안내줄에 그 패턴이 표시됩니다.",
];

export function StrumGuide() {
  return (
    <div>
      <p className="mb-3 text-[11px] leading-snug text-gray-500">
        스트로크(스트러밍)는 피크로 여러 줄을 한 번에 긁는 주법입니다.
        연주설정의 「스트로크」에서 곡에 맞는 패턴을 추천받아 고를 수
        있습니다 — 여기서는 기본기와 패턴, 연습 순서를 익힙니다.
      </p>

      <h3 className="mb-1.5 text-sm font-semibold">기본기</h3>
      <ul className="mb-3 space-y-1.5">
        {BASICS.map((b) => (
          <li
            key={b.title}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-0.5 text-[13px] font-bold">{b.title}</div>
            <p className="text-[11px] leading-snug text-gray-500">{b.body}</p>
          </li>
        ))}
      </ul>

      <h3 className="mb-1 text-sm font-semibold">표준 패턴</h3>
      <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
        한 칸이 8분음표 하나(4/4 한 마디 = 8칸), ↓·↑이 긋는 방향, ·은
        쉬는 칸입니다.{" "}
        <b className="text-[var(--accent)]">색이 든 화살표</b>가 크게 긋는
        악센트입니다.
      </p>
      <ul className="mb-3 space-y-1">
        {PATTERNS.map((p) => (
          <li
            key={p.name}
            className="rounded border border-gray-200 px-2.5 py-1.5 dark:border-gray-700"
          >
            <div className="flex items-baseline gap-2">
              <StrumCells pattern={p} className="text-sm" />
              <span className="text-xs font-medium">{p.name}</span>
              <span className="ml-auto text-[10px] text-gray-400">
                {p.bpm[0]}–{p.bpm[1]} BPM
              </span>
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
              {p.hint}
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mb-1.5 text-sm font-semibold">연습 순서</h3>
      <ol className="space-y-1.5">
        {PRACTICE.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[11px] font-bold text-[var(--accent)]">
              {i + 1}
            </span>
            <p className="text-[12px] leading-snug text-gray-600 dark:text-gray-300">
              {step}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
