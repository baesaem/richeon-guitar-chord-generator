import type { Bar } from "./bars";
import type { Strum } from "./types";

/**
 * 통기타 표준 스트로크 패턴.
 *
 * 소리에서 스트로크를 그대로 뽑아 보니 쓸 수 없었다. 한 곡 99마디에서
 * 45가지 패턴이 나왔고 최다가 6%였다 — 사람이 매번 똑같이 치지 않고,
 * 다른 악기 소리도 섞여 들어오기 때문이다.
 *
 * 그래서 방향을 바꿨다. 기타 교실에서 실제로 하는 방식대로, **곡에
 * 어울리는 표준 패턴을 골라 제시한다.** 고르는 근거는 두 가지다.
 *   1) 소리에서 뽑은 칸별 타율 — 실제 연주에 가장 가까운 패턴을 찾는다
 *   2) 그것이 없으면 템포 — 빠르기에 맞는 패턴을 권한다
 *
 * 각 패턴은 한 마디를 8분음표 여덟 칸으로 적는다.
 * D=쓸어내림(↓), U=쓸어올림(↑), .=쉼
 *
 * accents 는 크게 긋는 칸(악센트)이다. 같은 화살표라도 어디를 세게
 * 치는지에 따라 리듬이 완전히 달라진다 — 고고는 2·4박을 세게 쳐야
 * 고고답게 들린다.
 */

export interface StrumPattern {
  name: string;
  /** 8칸. D/U/. */
  cells: string;
  /** 이 패턴이 어울리는 빠르기 범위(BPM) */
  bpm: [number, number];
  hint: string;
  /** 크게 긋는 칸. 8칸 중 '>' 자리가 악센트 */
  accents?: string;
  /**
   * 화면에 몇 칸씩 묶어 보일까. 없으면 둘씩.
   *
   * 한 박을 셋으로 나누는 패턴(슬로우 락)은 셋씩 묶어야 「쿵 따다」로
   * 읽힌다. 둘씩 묶으면 박이 어디서 시작하는지 알 수 없다.
   */
  per?: number;
}

export const PATTERNS: StrumPattern[] = [
  {
    name: "고고",
    cells: "D.DUD.DU",
    bpm: [100, 160],
    hint: "가장 많이 쓰는 8비트. 밝고 경쾌한 곡에 두루 맞습니다.",
    accents: "..>...>.",
  },
  {
    name: "슬로우 고고",
    cells: "D.DU.UDU",
    bpm: [60, 100],
    hint: "느린 곡의 기본. 2·4박을 비워 두어 여유가 생깁니다.",
    accents: ">.....>.",
  },
  {
    name: "칼립소",
    cells: "D.DU.UDU",
    bpm: [90, 130],
    hint: "엇박을 살려 통통 튀는 느낌. 포크·동요에 잘 맞습니다.",
    accents: ">..>....",
  },
  {
    name: "8비트 기본",
    cells: "DUDUDUDU",
    bpm: [70, 140],
    hint: "여덟 칸을 모두 칩니다. 리듬을 익히는 첫 연습에 좋습니다.",
    accents: ">...>...",
  },
  {
    name: "4비트",
    cells: "D.D.D.D.",
    bpm: [50, 110],
    hint: "박마다 한 번씩만. 코드 바꾸기를 익힐 때 씁니다.",
    accents: "..>...>.",
  },
  {
    name: "발라드",
    cells: "D..UD.DU",
    bpm: [55, 90],
    hint: "느린 발라드. 첫 박을 크게 긋고 사이를 가볍게 채웁니다.",
    accents: ">.......",
  },
  {
    name: "셔플",
    cells: "D.UD.UD.",
    bpm: [80, 140],
    hint: "세 잇단 느낌으로 튕기듯. 블루스·로큰롤에 씁니다.",
    accents: ">..>....",
  },
  {
    name: "슬로우 락",
    // 한 박을 셋으로 나눈 12칸. 박마다 내려긋고, 2·4박 끝에 올려 긋는다
    cells: "D..D.UD..D.U",
    bpm: [50, 100],
    hint: "12비트. 한 박을 셋으로 나눠 「쿵 따다」로 흔듭니다. 느린 발라드·록에 씁니다.",
    accents: ">.....>.....",
    per: 3,
  },
  {
    name: "왈츠",
    cells: "D.U.U.  ",
    bpm: [80, 180],
    hint: "3박자 곡. 첫 박을 내려긋고 나머지를 올려 긋습니다.",
    accents: ">.......",
  },
  {
    name: "트로트(폴카)",
    cells: "D.U.D.U.",
    bpm: [90, 170],
    hint: "쿵짝 쿵짝 두 박 느낌. 트로트·폴카에 맞습니다.",
    accents: ">...>...",
  },
  {
    name: "오프비트(레게)",
    cells: ".U.U.U.U",
    bpm: [80, 140],
    hint: "박 사이만 올려 긋습니다. 가볍게 흔들리는 느낌이 납니다.",
    accents: ".>...>..",
  },
  // ---- 더한 패턴(⑫~⑯). 자동 추천에도 함께 든다 ----
  {
    name: "팝 8비트",
    cells: "D.DUDUDU",
    bpm: [90, 150],
    hint: "고고에서 뒤 두 박을 쉬지 않고 채워 꽉 찬 느낌. 가요·팝 반주에 두루 씁니다.",
    accents: "..>...>.",
  },
  {
    name: "록 발라드",
    cells: "D.D.DUDU",
    bpm: [70, 120],
    hint: "앞 두 박은 크게 한 번씩, 뒤 두 박은 8분으로 채웁니다. 록 발라드·가요 후렴에 맞습니다.",
    accents: "..>...>.",
  },
  {
    name: "느린 발라드",
    cells: "D...D.DU",
    bpm: [50, 85],
    hint: "첫 박을 길게 울리고 3·4박을 짧게 채웁니다. 아주 느린 발라드·포크에 씁니다.",
    accents: ">.......",
  },
  {
    name: "3·3·2 당김",
    cells: "D..D..D.",
    bpm: [80, 140],
    hint: "1박·2박 반·4박에 긋는 당김 리듬(트레실로). 라틴·팝 발라드 후렴에 힘을 줍니다.",
    accents: ">..>..>.",
  },
  {
    name: "록 다운스트로크",
    cells: "DDDDDDDD",
    bpm: [100, 180],
    hint: "여덟 칸을 모두 내려긋습니다. 힘 있는 록·펑크 반주 — 손목 힘을 빼고 짧게 끊습니다.",
    accents: "..>...>.",
  },
];

/** 목록에서의 번호(1부터). 고르기 창과 추천 줄이 같은 번호로 부른다 */
export function strumNo(name: string): number {
  return PATTERNS.findIndex((p) => p.name === name) + 1;
}

/** 번호를 원문자로(①~⑳). 그 너머는 「21.」처럼 적는다 */
export function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x245f + n) : `${n}.`;
}

/** 화면 표기로 바꾼다: "D.DUD.DU" → "↓·↓↑ ↓·↓↑" */
export function render(cells: string, per = 2): string {
  const marks = cells
    .trim()
    .split("")
    .map((c) => (c === "D" ? "↓" : c === "U" ? "↑" : "·"))
    .join("");
  const out: string[] = [];
  for (let i = 0; i < marks.length; i += per) out.push(marks.slice(i, i + per));
  return out.join(" ");
}

/** 마디 안에서 8분 칸마다 쳤는지 */
function slotsOf(bar: Bar, strums: Strum[]): boolean[] | null {
  const beats = bar.beatTimes;
  if (beats.length < 2) return null;
  const beatSpan = beats[1] - beats[0];
  const barEnd = beats[beats.length - 1] + beatSpan;
  const span = barEnd - bar.start;
  if (span <= 0) return null;

  const step = span / 8;
  const hit = Array.from({ length: 8 }, () => false);
  let count = 0;
  for (const s of strums) {
    if (s.t < bar.start - step * 0.3 || s.t >= barEnd) continue;
    const k = Math.round((s.t - bar.start) / step);
    if (k < 0 || k > 7) continue;
    if (Math.abs(bar.start + k * step - s.t) > step * 0.3) continue;
    if (!hit[k]) count += 1;
    hit[k] = true;
  }
  return count >= 3 ? hit : null;
}

/**
 * 이 곡에 어울리는 스트로크 패턴을 고른다.
 *
 * 소리에서 뽑은 칸별 타율이 있으면 그것과 가장 가까운 표준 패턴을,
 * 없으면 템포에 맞는 패턴을 권한다. 어느 쪽인지 이유도 함께 돌려준다.
 */
/** 고른 패턴과 고른 이유 */
export interface StrumChoice {
  pattern: StrumPattern;
  why: string;
}

export function suggestStrum(
  bars: Bar[],
  strums: Strum[] | undefined,
  bpm: number,
  timeSignature: string,
): StrumChoice | null {
  const threeFour = timeSignature.startsWith("3");
  const pool = PATTERNS.filter((p) =>
    threeFour ? p.name === "왈츠" : p.name !== "왈츠",
  );
  if (pool.length === 0) return null;

  // 1) 실제 연주와 가장 가까운 패턴
  if (strums?.length && bars.length > 4) {
    const tally = Array.from({ length: 8 }, () => 0);
    let counted = 0;
    for (const bar of bars) {
      const hit = slotsOf(bar, strums);
      if (!hit) continue;
      hit.forEach((h, i) => {
        if (h) tally[i] += 1;
      });
      counted += 1;
    }
    if (counted >= 4) {
      const rate = tally.map((n) => n / counted);
      let best: StrumPattern | null = null;
      let bestScore = -1;
      for (const p of pool) {
        const cells = p.cells.padEnd(8, " ").slice(0, 8);
        // 치는 칸의 타율은 높을수록, 쉬는 칸의 타율은 낮을수록 좋다
        let score = 0;
        for (let i = 0; i < 8; i++) {
          const strike = cells[i] === "D" || cells[i] === "U";
          score += strike ? rate[i] : 1 - rate[i];
        }
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (best) return { pattern: best, why: "연주에 가장 가까운 패턴" };
    }
  }

  // 2) 템포에 맞는 패턴
  const fit = pool.filter((p) => bpm >= p.bpm[0] && bpm <= p.bpm[1]);
  const picked = (fit.length ? fit : pool)[0];
  return { pattern: picked, why: `${Math.round(bpm)} BPM에 어울리는 패턴` };
}
