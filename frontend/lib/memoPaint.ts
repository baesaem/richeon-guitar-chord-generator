/**
 * 마디 위 메모를 칠하고 자리를 잡는다 — AbcScore가 악보를 그린 뒤에 부른다.
 *
 * 메모는 그릴 때만 덧말("^…")로 코드 이름 앞에 끼운다(addBarMemos). abcjs는
 * 메모를 오선 가까이, 그 마디 코드를 메모 위에 쌓아 자리를 비워 둔다
 * (강사님: 「메모는 코드 아래로」). 여기서:
 *
 * - 빨간 굵은 글씨·노란 바탕을 입히고 화살표·물결을 굵고 크게 칠한다
 * - 메모를 오선(또는 그 밑을 지나는 가장 높은 음표) 바로 위로 내린다
 * - 메모가 있는 줄의 코드 이름을 모두 같은 높이로 올려 맞춘다 — abcjs는
 *   메모 마디의 코드만 올려, 코드 줄이 들쭉날쭉했다(「다른 코드와 같은 줄로」)
 */

import { MEMO_MARK } from "./abcChordSwap";

/**
 * 메모 글자 크기(악보 그림 단위). abcjs는 서식 값에 4/3을 곱해 적는다 —
 * 코드 이름(서식 16)은 21. 강사님: 「크게」 뒤 「약간만 작게」
 */
export const MEMO_FONT = 18;
/** 제목줄 메모가 제목과 닿을 때 줄여 볼 수 있는 가장 작은 크기 */
const MEMO_FONT_MIN = 14;
/** 메모 글자색(강사님: 「빨간색」)과, 그보다 짙은 기호 색 */
const MEMO_COLOR = "#dc2626";
const SYMBOL_COLOR = "#991b1b";

/**
 * 제목줄 메모의 열쇠(강사님: 「상단 제목줄에도 왼쪽 오른쪽 메모」).
 * 마디 메모(숫자 열쇠)와 같은 칸(AbcEntry.memos)에 두어 곡 파일로 함께 간다.
 */
export const HEAD_LEFT = "head-left";
export const HEAD_RIGHT = "head-right";

const SVG_NS = "http://www.w3.org/2000/svg";

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

/** 이어 붙이는 옮김 — abcjs가 먼저 단 transform이 있으면 뒤에 붙인다 */
function translateY(el: Element, dy: number): void {
  if (!dy) return;
  el.setAttribute(
    "transform",
    `${el.getAttribute("transform") ?? ""} translate(0 ${dy})`.trim(),
  );
}

/**
 * 보이는 글자가 차지한 자리. 앞·뒤 빈칸(강사님이 메모를 밀어 둔 자리)은
 * 빼고 잰다 — 빈칸 밑의 코드·음표와는 부딪히지 않고, 바탕도 칠하지 않는다.
 */
function visibleBox(text: SVGGraphicsElement): Box | null {
  const b = bbox(text);
  if (!b || !b.width) return null;
  const s = text.textContent ?? "";
  const blank = /[\s​]/;
  let first = 0;
  while (first < s.length && blank.test(s[first])) first++;
  let last = s.length - 1;
  while (last > first && blank.test(s[last])) last--;
  if (first >= s.length || (first === 0 && last === s.length - 1)) return b;
  try {
    const t = text as SVGTextContentElement;
    const x0 = first > 0 ? Math.max(b.x, t.getStartPositionOfChar(first).x) : b.x;
    const x1 =
      last < s.length - 1
        ? Math.min(b.x + b.width, t.getEndPositionOfChar(last).x)
        : b.x + b.width;
    return { ...b, x: x0, width: Math.max(x1 - x0, 1) };
  } catch {
    return b;
  }
}

/** 화살표·물결 — 굵고 짙게, 영문 대문자보다 크게(강사님) */
const SYMBOL = /[↓↑←→↕↗↘↙↖~〜∼]/;
const ARROW = /[↓↑←→↕↗↘↙↖]/;
/** 영문 소문자 덩이 — 작게, 아래첨자로(강사님: 「영문자 소문자는 작게」) */
const LOWER_RUN = /^[a-z]+$/;
/** 화살표·물결·영문 소문자 덩이를 따로 뗀다 — 저마다 달리 칠한다 */
const SYMBOL_RUNS = /([↓↑←→↕↗↘↙↖]+|[~〜∼]+|[a-z]+)/;

/**
 * 메모 글을 적는다. 화살표·물결은 따로 떼어 1.25배·가장 굵게·짙게 칠한다 —
 * 가는 기호가 굵은 글자 사이에서 흐려 보였다.
 *
 * abcjs는 글을 tspan 하나에 담아 x 자리를 거기 둔다. 그 tspan이 있으면
 * 그 안을 채운다(자리를 지키려고).
 */
function setMemoText(el: SVGElement, s: string): void {
  const holder =
    [...el.children].find(
      (c) =>
        c.tagName.toLowerCase() === "tspan" &&
        !c.classList.contains("memo-sym") &&
        !c.classList.contains("memo-sub"),
    ) ?? el;
  holder.textContent = "";
  for (const part of s.split(SYMBOL_RUNS)) {
    if (!part) continue;
    if (LOWER_RUN.test(part)) {
      // 영문 소문자는 작게, 아래첨자로 — 코드 이름의 sus·m처럼
      const sub = document.createElementNS(SVG_NS, "tspan");
      sub.setAttribute("class", "memo-sub");
      sub.style.fontSize = "0.7em";
      sub.setAttribute("baseline-shift", "sub");
      sub.textContent = part;
      holder.appendChild(sub);
      continue;
    }
    if (!SYMBOL.test(part)) {
      holder.appendChild(document.createTextNode(part));
      continue;
    }
    const t = document.createElementNS(SVG_NS, "tspan");
    t.setAttribute("class", "memo-sym");
    t.style.fontSize = "1.25em";
    t.setAttribute("fill", SYMBOL_COLOR);
    if (ARROW.test(part)) {
      /* 화살표는 크고 가늘게 — 명조 계열의 가는 화살표에 굵기·테두리 없이
         (강사님: 「↓x 이런 형식으로, 화살표 가늘게」) */
      t.style.fontWeight = "normal";
      t.style.fontFamily = '"Times New Roman", serif';
    } else {
      // 물결은 가는 획을 같은 색 테두리로 두껍게
      t.style.fontWeight = "900";
      t.setAttribute("stroke", SYMBOL_COLOR);
      t.setAttribute("stroke-width", "0.8");
    }
    t.textContent = part;
    holder.appendChild(t);
  }
}

/** 메모 글자를 빨간 굵은 글씨로 */
function styleMemo(text: SVGGraphicsElement, size: number): void {
  text.setAttribute("fill", MEMO_COLOR);
  text.setAttribute("font-weight", "bold");
  text.setAttribute("stroke", "none");
  text.style.fontWeight = "bold";
  text.style.fontSize = `${size}px`;
}

/** 노란 바탕을 글자 뒤에 깐다 */
function underlay(text: SVGGraphicsElement, box: Box, dy = 0): void {
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", String(box.x - 2));
  bg.setAttribute("y", String(box.y - 1));
  bg.setAttribute("width", String(box.width + 4));
  bg.setAttribute("height", String(box.height + 2));
  bg.setAttribute("rx", "2");
  bg.setAttribute("fill", "#fde68a");
  bg.setAttribute("stroke", "none");
  translateY(bg, dy);
  text.parentNode?.insertBefore(bg, text);
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

  // 줄마다 오선 윗줄 높이
  const staffTop = new Map<string, number>();
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("g.abcjs-staff")) {
    const line = lineOf(el);
    const b = bbox(el);
    if (line === undefined || !b) continue;
    const had = staffTop.get(line);
    if (had === undefined || b.y < had) staffTop.set(line, b.y);
  }

  // 1) 칠하고, 오선(또는 밑을 지나는 가장 높은 음표) 바로 위로 내린다
  const placed: { text: SVGGraphicsElement; line?: string; box: Box; dy: number }[] = [];
  for (const text of memos) {
    const line = lineOf(text) ?? lineOf(text.parentElement);
    styleMemo(text, MEMO_FONT);
    setMemoText(text, text.textContent ?? "");
    const box = visibleBox(text);
    if (!box) continue;
    let floor = line === undefined ? undefined : staffTop.get(line);
    if (line !== undefined)
      for (const p of svg.querySelectorAll<SVGGraphicsElement>(
        `g.abcjs-note.abcjs-l${line} path`,
      )) {
        const q = bbox(p);
        if (q && q.height && q.x < box.x + box.width && q.x + q.width > box.x)
          floor = Math.min(floor ?? q.y, q.y);
      }
    const dy = floor === undefined ? 0 : Math.max(0, floor - 2 - (box.y + box.height));
    translateY(text, dy);
    placed.push({ text, line, box, dy });
  }

  /* 2) 메모가 있는 줄의 코드 이름을 한 높이로, 메모 바로 위에 붙여 둔다
        (강사님: 「코드와 메모 간격 축소」). 코드 제자리(abcjs가 둔 가장
        낮은 코드 줄)보다 내려가지는 않는다 — 솟은 음표와 부딪힌다 */
  const lines = new Set(placed.map((p) => p.line).filter((l) => l !== undefined));
  for (const line of lines) {
    const top = staffTop.get(line as string);
    const chords = [...svg.querySelectorAll<SVGGraphicsElement>(".abcjs-chord")]
      .filter((c) => lineOf(c) === line)
      .map((el) => ({ el, b: bbox(el) }))
      // 오선 위의 코드만(아래에 적는 코드 "_…"는 두지 않는다)
      .filter((c): c is { el: SVGGraphicsElement; b: Box } =>
        !!c.b && (top === undefined || c.b.y + c.b.height <= top + 2),
      );
    if (!chords.length) continue;
    const memoTop = Math.min(
      ...placed.filter((p) => p.line === line).map((p) => p.box.y + p.dy),
    );
    const natural = Math.max(...chords.map((c) => c.b.y + c.b.height));
    const bottom = Math.min(memoTop - 3, natural);
    for (const c of chords) translateY(c.el, bottom - c.b.height - c.b.y);
  }

  // 3) 노란 바탕
  for (const m of placed) underlay(m.text, m.box, m.dy);
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

  const put = (raw: string | undefined, side: "left" | "right") => {
    if (!raw?.trim()) return;
    // 빈칸은 앞·사이·뒤 모두 글자로 — 줄바꿈 없는 빈칸으로 바꿔야 걷히거나 줄지 않는다
    const lead = raw.length - raw.trimStart().length;
    const full = raw.replace(/\s/g, " ");
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "memo-head");
    g.setAttribute("pointer-events", "none");
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(side === "left" ? span[0] : span[1]));
    text.setAttribute("y", String(tb.y + tb.height / 2));
    text.setAttribute("text-anchor", side === "left" ? "start" : "end");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-family", "sans-serif");
    setMemoText(text, full);
    g.append(text);
    svg.appendChild(g);

    // 제목과 사이를 띄운다
    const clear = (b: Box | null) =>
      !b || (side === "left" ? b.x + b.width <= tb.x - 8 : b.x >= tb.x + tb.width + 8);
    let size = MEMO_FONT;
    styleMemo(text, size);
    let b = bbox(text);
    while (!clear(b) && size > MEMO_FONT_MIN) {
      size -= 2;
      styleMemo(text, size);
      b = bbox(text);
    }
    for (let n = full.length - 1; !clear(b) && n > lead; n--) {
      setMemoText(text, `${full.slice(0, n).trimEnd()}…`);
      b = bbox(text);
    }

    const v = visibleBox(text);
    if (v) underlay(text, v);
  };
  put(left, "left");
  put(right, "right");
}
