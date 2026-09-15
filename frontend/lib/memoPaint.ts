/**
 * 마디 위 메모를 칠하고 자리를 잡는다 — AbcScore가 악보를 그린 뒤에 부른다.
 *
 * 메모는 그릴 때만 덧말("^…")로 끼운다(addBarMemos). abcjs는 그 덧말을
 * 코드 이름 위에 그린다. 여기서 굵은 글씨·노란 바탕을 입히고, 자리가 나면
 * 오선 바로 위로 끌어내린다(강사님: 「메모는 악보 위에 바로 붙임」).
 *
 * 코드 이름 줄은 건드리지 않는다(강사님: 「메모 위 코드 — 다른 코드와 같은
 * 줄로」). 코드 줄과 음표 사이가 좁으면 글자를 조금씩 줄여 보고, 그래도
 * 안 들어가면 abcjs가 코드 위에 비워 둔 자리에 그대로 둔다.
 */

import { MEMO_MARK } from "./abcChordSwap";

/**
 * 메모 글자 크기(악보 그림 단위). abcjs는 서식 값에 4/3을 곱해 적는다 —
 * 코드 이름(서식 16)은 21, 덧말 기본(12)은 16. 강사님: 「메모 글자 크게」
 */
export const MEMO_FONT = 20;
/** 오선 위가 좁은 마디에서 줄여 볼 수 있는 가장 작은 크기 */
const MEMO_FONT_MIN = 16;

/**
 * 제목줄 메모의 열쇠(강사님: 「상단 제목줄에도 왼쪽 오른쪽 메모」).
 * 마디 메모(숫자 열쇠)와 같은 칸(AbcEntry.memos)에 두어 곡 파일로 함께 간다.
 */
export const HEAD_LEFT = "head-left";
export const HEAD_RIGHT = "head-right";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function bbox(el: SVGGraphicsElement): Box | null {
  try {
    const b = el.getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return null;
  }
}

/** abcjs가 붙인 줄 번호(abcjs-l{n}) */
function lineOf(el: Element | null): string | undefined {
  return /\babcjs-l(\d+)\b/.exec(el?.getAttribute("class") ?? "")?.[1];
}

/**
 * 보이는 글자가 차지한 자리. 앞쪽 빈칸(강사님이 메모를 오른쪽으로 민 자리)은
 * 빼고 잰다 — 빈칸 밑의 코드·음표와는 부딪히지 않는다.
 */
function visibleBox(text: SVGGraphicsElement): Box | null {
  const b = bbox(text);
  if (!b || !b.width) return null;
  const first = (text.textContent ?? "").search(/[^\s​ ]/);
  if (first <= 0) return b;
  try {
    const x0 = Math.max(
      b.x,
      (text as SVGTextContentElement).getStartPositionOfChar(first).x,
    );
    return { ...b, x: x0, width: b.x + b.width - x0 };
  } catch {
    return b;
  }
}

export function paintMemos(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  const memos = [...svg.querySelectorAll<SVGGraphicsElement>(".abcjs-annotation")]
    .map((el) =>
      el.tagName.toLowerCase() === "text"
        ? el
        : el.querySelector<SVGGraphicsElement>("text"),
    )
    .filter(
      (t): t is SVGGraphicsElement =>
        !!t && (t.textContent ?? "").includes(MEMO_MARK),
    );
  if (!memos.length) return;

  // 줄마다 오선 윗줄 높이와 코드 이름 자리
  const staffTop = new Map<string, number>();
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("g.abcjs-staff")) {
    const line = lineOf(el);
    const b = bbox(el);
    if (line === undefined || !b) continue;
    const had = staffTop.get(line);
    if (had === undefined || b.y < had) staffTop.set(line, b.y);
  }
  const chordBoxes = new Map<string, Box[]>();
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(".abcjs-chord")) {
    const line = lineOf(el);
    const b = bbox(el);
    if (line === undefined || !b) continue;
    chordBoxes.set(line, [...(chordBoxes.get(line) ?? []), b]);
  }

  for (const text of memos) {
    const line = lineOf(text) ?? lineOf(text.parentElement);
    text.setAttribute("fill", "#7c2d12");
    text.setAttribute("font-weight", "bold");
    text.style.fontWeight = "bold";

    /** 메모 밑으로 지나가는 것 중 가장 높은 곳 — 오선 윗줄이나 솟은 음표 */
    const floorUnder = (b: Box): number | undefined => {
      if (line === undefined) return undefined;
      let floor = staffTop.get(line);
      for (const p of svg.querySelectorAll<SVGGraphicsElement>(
        `g.abcjs-note.abcjs-l${line} path`,
      )) {
        const q = bbox(p);
        if (q && q.height && q.x < b.x + b.width && q.x + q.width > b.x)
          floor = Math.min(floor ?? q.y, q.y);
      }
      return floor;
    };
    const hitsChord = (b: Box, dy: number): boolean =>
      (line === undefined ? [] : (chordBoxes.get(line) ?? [])).some(
        (c) =>
          c.x < b.x + b.width &&
          c.x + c.width > b.x &&
          c.y < b.y + dy + b.height &&
          c.y + c.height > b.y + dy,
      );

    // 큰 글자부터 — 코드 이름을 건드리지 않고 오선 위에 들어가는 크기를 찾는다
    let shift = 0;
    let box: Box | null = null;
    for (let size = MEMO_FONT; size >= MEMO_FONT_MIN; size -= 2) {
      text.style.fontSize = `${size}px`;
      const b = visibleBox(text);
      if (!b) break;
      const floor = floorUnder(b);
      const dy = floor === undefined ? 0 : floor - 2 - (b.y + b.height);
      if (dy <= 0 || !hitsChord(b, dy)) {
        shift = Math.max(dy, 0);
        box = b;
        break;
      }
    }
    if (!box) {
      // 오선 위가 좁은 마디 — 코드 줄 위(abcjs가 비워 둔 자리)에 그대로
      text.style.fontSize = `${MEMO_FONT}px`;
      box = visibleBox(text);
      shift = 0;
    }
    if (!box) continue;

    const move = shift
      ? `${text.getAttribute("transform") ?? ""} translate(0 ${shift})`.trim()
      : null;
    if (move) text.setAttribute("transform", move);
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    if (move) bg.setAttribute("transform", move);
    bg.setAttribute("x", String(box.x - 2));
    bg.setAttribute("y", String(box.y - 1));
    bg.setAttribute("width", String(box.width + 4));
    bg.setAttribute("height", String(box.height + 2));
    bg.setAttribute("rx", "2");
    bg.setAttribute("fill", "#fde68a");
    bg.setAttribute("stroke", "none");
    text.parentNode?.insertBefore(bg, text);
  }
}

/** 오선이 차지한 가로 범위 — 제목줄 메모의 왼끝·오른끝 */
function staffSpan(svg: SVGSVGElement): [number, number] | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const s of svg.querySelectorAll<SVGGraphicsElement>("g.abcjs-staff")) {
    const b = bbox(s);
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    x1 = Math.max(x1, b.x + b.width);
  }
  return Number.isFinite(x0) ? [x0, x1] : null;
}

/**
 * 제목줄(제목·부제·지은이)이 차지한 자리를 오선 폭으로 넓힌 것.
 * 여기를 오른쪽 클릭하면 제목줄 메모를 연다.
 */
export function titleRowBox(svg: SVGSVGElement): Box | null {
  const top = svg.querySelector<SVGGraphicsElement>(".abcjs-meta-top");
  const b = top ? bbox(top) : null;
  const span = staffSpan(svg);
  if (!b || !b.height || !span) return null;
  return { x: span[0], y: b.y, width: span[1] - span[0], height: b.height };
}

/**
 * 제목줄 왼쪽·오른쪽 메모를 그린다.
 *
 * 제목과 같은 높이에, 왼쪽 메모는 오선 왼끝부터, 오른쪽 메모는 오선
 * 오른끝까지. 제목과 겹치면 글자를 줄여 보고, 그래도 겹치면 끝을 「…」로
 * 자른다 — 다 읽으려면 제목줄을 연다.
 */
export function paintHeadMemos(
  host: HTMLElement,
  left: string | undefined,
  right: string | undefined,
): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  svg.querySelectorAll(".memo-head").forEach((n) => n.remove());
  if (!left?.trim() && !right?.trim()) return;
  const title = svg.querySelector<SVGGraphicsElement>(".abcjs-title");
  const tb = title ? bbox(title) : null;
  const span = staffSpan(svg);
  if (!tb || !span) return;
  const NS = "http://www.w3.org/2000/svg";

  const put = (raw: string | undefined, side: "left" | "right") => {
    if (!raw?.trim()) return;
    // 앞쪽 빈칸은 글자로 — 줄바꿈 없는 빈칸으로 바꿔야 걷히지 않는다
    const lead = Math.min(raw.length - raw.trimStart().length, 40);
    const full = " ".repeat(lead) + raw.trim().replace(/\s+/g, " ");
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "memo-head");
    g.setAttribute("pointer-events", "none");
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", String(side === "left" ? span[0] : span[1]));
    text.setAttribute("y", String(tb.y + tb.height / 2));
    text.setAttribute("text-anchor", side === "left" ? "start" : "end");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-family", "sans-serif");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("fill", "#7c2d12");
    text.setAttribute("stroke", "none");
    text.textContent = full;
    g.append(text);
    svg.appendChild(g);

    // 제목과 사이를 띄운다
    const clear = (b: Box | null) =>
      !b || (side === "left" ? b.x + b.width <= tb.x - 8 : b.x >= tb.x + tb.width + 8);
    let size = MEMO_FONT;
    text.style.fontSize = `${size}px`;
    let b = bbox(text);
    while (!clear(b) && size > MEMO_FONT_MIN) {
      size -= 2;
      text.style.fontSize = `${size}px`;
      b = bbox(text);
    }
    for (let n = full.length - 1; !clear(b) && n > lead; n--) {
      text.textContent = `${full.slice(0, n).trimEnd()}…`;
      b = bbox(text);
    }

    const v = visibleBox(text);
    if (!v) return;
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", String(v.x - 2));
    bg.setAttribute("y", String(v.y - 1));
    bg.setAttribute("width", String(v.width + 4));
    bg.setAttribute("height", String(v.height + 2));
    bg.setAttribute("rx", "2");
    bg.setAttribute("fill", "#fde68a");
    bg.setAttribute("stroke", "none");
    g.insertBefore(bg, text);
  };
  put(left, "left");
  put(right, "right");
}
