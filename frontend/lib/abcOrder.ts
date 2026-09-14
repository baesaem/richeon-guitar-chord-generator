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
  /** 이 마디가 든 줄 아래 가사 줄(w:)이 몇 절까지 있나. 가사가 없으면 0 */
  verses: number;
};

/**
 * 본문을 마디로 쪼갠다. 가사·주석 줄은 연주와 무관하므로 뺀다 — 다만
 * 가사 줄(w:)이 몇 절까지 있는지는 마디마다 적어 둔다. 되돌이 뒤에
 * 도돌이를 다시 부르는지 가리는 데 쓴다(abcOrders).
 */
export function abcMeasures(abc: string): AbcMeasure[] {
  const lines = abc.split("\n");
  let i = 0;
  for (; i < lines.length; i++) if (/^K:/.test(lines[i])) { i++; break; }
  // 음표 줄마다: 본문에서의 자리, 그 아래 가사 줄 중 글자가 든 마지막 절
  const rows: { text: string; at: number; seen: number; verses: number }[] = [];
  let at = 0;
  for (const l of lines.slice(i)) {
    if (!l.trim() || /^(W:|%)/.test(l)) continue;
    if (/^w:/.test(l)) {
      const row = rows[rows.length - 1];
      if (!row) continue;
      row.seen++;
      // 「*」「_」「-」뿐인 줄은 그 절을 부르지 않는 자리다
      if (/[^\s*_\-|~]/.test(l.slice(2))) row.verses = row.seen;
      continue;
    }
    rows.push({ text: l, at, seen: 0, verses: 0 });
    at += l.length + 1;
  }
  const body = rows.map((r) => r.text).join(" ");

  const out: AbcMeasure[] = [];
  let buf = "";
  let startRepeat = false;
  let row = -1;
  let rowVerses = 0; // 지금 읽는 줄의 절 수
  let bufVerses = 0; // 지금 모으는 마디가 걸친 줄들의 절 수
  const close = (bar: string) => {
    let text = buf.trim();
    buf = "";
    let volta: number | null = null;
    /* 1·2번 괄호. 줄 머리의 [V:1] 같은 줄 안 지시 뒤에 오기도 한다 —
       「혜화동」은 「[V:1] [1」이라 1번 괄호를 못 알아봐 두 번째 돌 때도
       1번 괄호 9마디를 쳐서, 97마디가 106마디로 셈해졌다 */
    const v = text.match(/^((?:\[[A-Za-z]:[^\]]*\]\s*)*)\[(\d+)[-,.\d]*\s*/);
    if (v) {
      volta = +v[2];
      text = v[1] + text.slice(v[0].length);
    }
    if (/[A-Ga-gz]/.test(text))
      out.push({ text, volta, startRepeat, endRepeat: /^:/.test(bar), verses: bufVerses });
    startRepeat = /:$/.test(bar);
    bufVerses = rowVerses;
  };
  for (let k = 0; k < body.length; ) {
    // 줄이 바뀌면 그 줄의 절 수를 잡는다. 앞 줄에서 이어진 마디면 둘 중 큰 것
    while (row + 1 < rows.length && k >= rows[row + 1].at) {
      row++;
      rowVerses = rows[row].verses;
      bufVerses = buf.trim() ? Math.max(bufVerses, rowVerses) : rowVerses;
    }
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
    // 겹세로줄 뒤에 도돌이가 시작하면 뮤즈스코어 변환이 「||:」로 적는다.
    // 「||」만 떼어 가면 「:」가 다음 마디 글자로 남아 도돌이 시작을 놓쳤다 —
    // 「첫사랑」은 22마디로 돌아가야 할 것을 1마디로 돌아가 51마디가 72마디가 되었다.
    const bar = body.slice(k).match(/^(:\|:|::|\|\|:|\[\|:|\|:|:\||\|\]|\|\||\|)/);
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
  /*
   * 되돌아간 뒤에도 도돌이를 다시 부르는가.
   *
   * 보통은 되돌이(D.S.·D.C.) 뒤에는 도돌이표를 건너뛴다. 그런데 되돌아가
   * 닿는 도돌이 구간에 가사가 3절 이상 적혀 있으면, 두 바퀴로는 다 부를 수
   * 없다 — 되돌아가서 한 번 더 돌며 3·4절을 부른다는 뜻이다. 「잊혀지는 것」
   * (김광석)이 그렇다. 건너뛰면 113마디로 펴져, 129마디인 음원에 박자를
   * 억지로 깔아 ♩136 곡이 ♩113으로 느리게 갔다.
   */
  const repeatAfterJump = (() => {
    if (jump < 0) return false;
    const target = /D\.\s*C\./i.test(txt[jump]) ? 0 : segno >= 0 ? segno : 0;
    const end = ms.findIndex((m, k) => k >= target && k < jump && m.endRepeat);
    if (end < 0) return false;
    let start = target;
    for (let k = end; k >= target; k--) if (ms[k].startRepeat) { start = k; break; }
    let verses = 0;
    for (let k = start; k <= end; k++) verses = Math.max(verses, ms[k].verses);
    return verses > 2;
  })();

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
      if (m.volta && m.volta !== pass) {
        /*
         * 이번 바퀴에 부르지 않는 괄호는 **괄호가 끝날 때까지** 건너뛴다.
         *
         * 괄호는 번호가 적힌 마디 하나가 아니다. 1번 괄호는 되돌이 끝(:|)
         * 까지 이어지는데, 그 끝 마디에는 번호가 적혀 있지 않다 — 한 마디만
         * 건너뛰면 그 마디를 두 번 부른다. 마디 수가 하나 어긋나면 abcjs가
         * 센 것과 맞지 않아 되돌이 짝짓기가 통째로 어긋나고, 달세뇨·코다
         * 분기도 먹지 않는다(「광화문 연가」가 그랬다).
         */
        let k = i;
        let closed = false;
        while (k < ms.length) {
          const cur = ms[k];
          k++;
          if (cur.endRepeat) { closed = true; break; }        // :| 에서 닫힌다
          if (k < ms.length && ms[k].volta) { closed = true; break; }  // 다음 괄호
        }
        // 닫는 것을 못 찾으면 한 마디만 건너뛴다 — 뒤를 통째로 잃느니 낫다
        i = closed ? k : i + 1;
        continue;
      }
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
        // 되돌아온 뒤에는 도돌이표를 다시 잡지 않는다 — 3절 이상이면 다시 돈다
        if (repeatAfterJump) doneEnd.clear();
        continue;
      }
      if (useJump && jumped && !alFine && i === toCoda && coda >= 0) { i = coda; continue; }
      if (useJump && jumped && alFine && i === fine) break;
      i++;
    }
    return order;
  };
  return { measures: ms, noJump: walk(false), withJump: walk(true) };
}
