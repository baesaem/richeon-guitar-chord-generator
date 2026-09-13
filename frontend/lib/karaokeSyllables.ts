/**
 * 노래방 가사를 음원에 맞춘다(강사님: 「가사는 음원을 따르게」).
 *
 * 가사 줄에는 줄의 시작·끝 시각만 있어, 줄 안의 글자를 고르게 펴면 실제로
 * 부르는 자리와 어긋난다. 멜로디 악보(ABC)가 붙은 곡은 음표마다 가사 음절이
 * 붙어 있고, 악보 마디는 음원 마디에 이어져 있다(연습실 커서가 따라가는 셈).
 * 그래서 음절마다 「그 음표가 마디 안 어디인가」를 음원 마디의 시각에 옮기면
 * 부르는 순간에 맞는 시각이 나온다.
 *
 * 악보는 abcjs로 읽는다 — 화면에 그려진 악보와 같은 셈이라 붙임줄·셋잇단·
 * 1·2절 가사가 악보와 똑같이 붙는다. 도돌이를 두 번째 돌면 2절 가사를 쓴다.
 */

export interface KaraokeSyl {
  /** 음원(코드 싱크 쪽) 시각 */
  t: number;
  text: string;
  /** 뒤에 띄어 쓴다(단어가 끝남) */
  space: boolean;
}

interface AbcLyric {
  syllable?: string;
  divider?: string;
}
interface AbcEl {
  el_type?: string;
  duration?: number;
  rest?: unknown;
  lyric?: AbcLyric[];
  startTriplet?: number;
  tripletMultiplier?: number;
  endTriplet?: boolean;
}

interface Measure {
  total: number;
  items: { off: number; lyric: AbcLyric[] }[];
}

/** 악보를 마디마다 「음표 자리·그 음표의 가사(절마다)」로 */
async function measuresOf(abc: string): Promise<Measure[]> {
  const ABCJS = (await import("abcjs")).default;
  const tunes = ABCJS.parseOnly(abc) as unknown as {
    lines?: { staff?: { voices?: AbcEl[][] }[] }[];
  }[];
  const tune = tunes[0];
  if (!tune?.lines) return [];
  const out: Measure[] = [];
  let cur: Measure = { total: 0, items: [] };
  let mult = 1;
  const close = () => {
    // 음표가 하나도 없는 조각(줄 머리의 도돌이표 등)은 마디가 아니다
    if (cur.total > 0) out.push(cur);
    cur = { total: 0, items: [] };
  };
  for (const line of tune.lines) {
    // 멜로디는 첫 보표의 첫 성부다 — 가사가 붙는 줄
    const voice = line.staff?.[0]?.voices?.[0];
    if (!voice) continue;
    for (const el of voice) {
      if (el.el_type === "bar") {
        close();
        continue;
      }
      if (el.el_type !== "note") continue;
      if (el.startTriplet) mult = el.tripletMultiplier ?? 2 / 3;
      const d = (el.duration ?? 0) * mult;
      if (!el.rest && el.lyric?.length) cur.items.push({ off: cur.total, lyric: el.lyric });
      cur.total += d;
      if (el.endTriplet) mult = 1;
    }
  }
  close();
  return out;
}

/**
 * 음원 마디(bars)마다 그 자리의 악보 마디를 찾아, 음절을 음원 시각에 놓는다.
 *
 * scoreBarNumbers[i]는 음원 마디 i가 악보 몇 마디인지(1부터, 도돌이까지 편 것).
 * 없으면 마디밀기(barOffset)만큼 밀어 센다 — 연습실 커서와 같은 셈이다.
 */
export async function syllablesFromAbc(
  abc: string,
  bars: ReadonlyArray<{ start: number; end: number }>,
  // 음원 마디 번호 → 악보 마디 번호(배열이든 번호표든)
  scoreBarNumbers: { readonly [i: number]: number | null | undefined } | null | undefined,
  barOffset: number,
): Promise<KaraokeSyl[]> {
  const measures = await measuresOf(abc);
  if (!measures.length) return [];
  const seen = new Map<number, number>();
  const out: KaraokeSyl[] = [];
  bars.forEach((b, i) => {
    const no = scoreBarNumbers?.[i];
    const j = no !== undefined && no !== null ? no - 1 : i - barOffset;
    if (!Number.isInteger(j) || j < 0 || j >= measures.length) return;
    // 같은 악보 마디를 두 번째 치면 2절 가사
    const verse = seen.get(j) ?? 0;
    seen.set(j, verse + 1);
    const m = measures[j];
    const span = b.end - b.start;
    for (const it of m.items) {
      const l = it.lyric[verse] ?? it.lyric[0];
      const text = (l?.syllable ?? "").trim();
      if (!text || text === "*") continue;
      out.push({
        t: b.start + (it.off / m.total) * span,
        text,
        space: l?.divider !== "-",
      });
    }
  });
  return out;
}
