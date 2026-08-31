/**
 * 악보의 진행 순서 — 도돌이표·1·2번 괄호·달세뇨·다카포·코다.
 *
 * abcjs는 도돌이표(|: :|)와 볼타까지만 연주에 반영하고, 세뇨·코다
 * 되돌이는 기호로 그리기만 한다. 악보는 원본 그대로 두어야 하므로
 * 여기서 실제 연주 차례를 따로 셈해, 진행바가 그 차례를 따라가게 한다.
 */

export type AbcMeasure = {
  text: string;
  volta: number | null;
  startRepeat: boolean;
  endRepeat: boolean;
};

/** 본문을 마디로 쪼갠다. 가사·주석 줄은 연주와 무관하므로 뺀다 */
export function abcMeasures(abc: string): AbcMeasure[] {
  const lines = abc.split("\n");
  let i = 0;
  for (; i < lines.length; i++) if (/^K:/.test(lines[i])) { i++; break; }
  const body = lines
    .slice(i)
    .filter((l) => l.trim() && !/^(w:|W:|%)/.test(l))
    .join(" ");

  const out: AbcMeasure[] = [];
  let buf = "";
  let startRepeat = false;
  const close = (bar: string) => {
    let text = buf.trim();
    buf = "";
    let volta: number | null = null;
    const v = text.match(/^\[(\d+)[-,.\d]*\s*/); // 1·2번 괄호
    if (v) {
      volta = +v[1];
      text = text.slice(v[0].length);
    }
    if (/[A-Ga-gz]/.test(text))
      out.push({ text, volta, startRepeat, endRepeat: /^:/.test(bar) });
    startRepeat = /:$/.test(bar);
  };
  for (let k = 0; k < body.length; ) {
    const c = body[k];
    // 따옴표 글자·장식기호·[K: 같은 줄 안 지시는 통째로 건너뛴다
    if (c === '"' || c === "!") {
      const e = body.indexOf(c, k + 1);
      const seg = body.slice(k, e < 0 ? body.length : e + 1);
      buf += seg;
      k += seg.length;
      continue;
    }
    if (c === "[" && /^\[[A-Za-z]:/.test(body.slice(k, k + 3))) {
      const e = body.indexOf("]", k);
      const seg = body.slice(k, e < 0 ? body.length : e + 1);
      buf += seg;
      k += seg.length;
      continue;
    }
    const bar = body.slice(k).match(/^(:\|:|::|\|:|:\||\|\]|\|\||\|)/);
    if (bar) {
      close(bar[1]);
      k += bar[1].length;
      continue;
    }
    buf += c;
    k++;
  }
  close("");
  return out;
}

export type AbcOrders = {
  measures: AbcMeasure[];
  /** abcjs가 실제로 소리내는 차례 — 도돌이표·볼타까지만 */
  noJump: number[];
  /** 달세뇨·다카포·코다까지 따라간 진짜 연주 차례 */
  withJump: number[];
};

export function abcOrders(abc: string): AbcOrders | null {
  const ms = abcMeasures(abc);
  if (!ms.length) return null;
  const txt = ms.map((m) => m.text);
  // 진행 지시는 정식 기호(!D.S.alcoda! 등)로도, 따옴표 글자로도 올 수 있다
  const JUMP_RE = /!D\.\s*[SC]\.[^!]*!|"[^"]*D\.\s*[SC]\.[^"]*"/;
  const segno = txt.findIndex((t) => /!segno!/.test(t));
  const codaMarks: number[] = [];
  txt.forEach((t, i) => { if (/!coda!/.test(t)) codaMarks.push(i); });
  let toCoda = txt.findIndex((t) => /"[^"]*[Tt]o\s*[Cc]oda[^"]*"/.test(t));
  let coda = -1;
  if (codaMarks.length >= 2) {
    // 코다 기호가 둘이면 앞의 것이 빠져나가는 자리, 뒤의 것이 코다 구역
    if (toCoda < 0) toCoda = codaMarks[0];
    coda = codaMarks[codaMarks.length - 1];
  } else if (codaMarks.length === 1 && codaMarks[0] !== toCoda) {
    coda = codaMarks[0];
  }
  const fine = txt.findIndex((t) => /!fine!|"[^"]*[Ff]ine[^"]*"/.test(t));
  const jump = txt.findIndex((t) => JUMP_RE.test(t));

  const walk = (useJump: boolean) => {
    const order: number[] = [];
    const doneEnd = new Set<number>();
    let i = 0;
    let repStart = 0;
    let pass = 1;
    let jumped = false;
    let alFine = false;
    let guard = 0;
    let back = false; // 도돌이표를 타고 되돌아온 참인가
    while (i >= 0 && i < ms.length && guard++ < ms.length * 8) {
      const m = ms[i];
      // 앞에서 걸어 들어왔을 때만 회차를 1로 되돌린다. 되돌아온 것까지
      // 1로 치면 1번 괄호만 되풀이하고 2번 괄호로 넘어가지 못한다.
      if (m.startRepeat && !back) { repStart = i; pass = 1; }
      back = false;
      if (m.volta && m.volta !== pass) { i++; continue; }
      order.push(i);
      if (m.endRepeat && !doneEnd.has(i)) {
        doneEnd.add(i);
        pass++;
        i = repStart;
        back = true;
        continue;
      }
      if (useJump && i === jump && !jumped) {
        jumped = true;
        alFine = /alfine|al\s*fine/i.test(txt[i]) || (coda < 0 && fine >= 0);
        i = /D\.\s*C\./i.test(txt[i]) ? 0 : segno >= 0 ? segno : 0;
        continue; // 되돌아온 뒤에는 도돌이표를 다시 잡지 않는다
      }
      if (useJump && jumped && !alFine && i === toCoda && coda >= 0) { i = coda; continue; }
      if (useJump && jumped && alFine && i === fine) break;
      i++;
    }
    return order;
  };
  return { measures: ms, noJump: walk(false), withJump: walk(true) };
}
