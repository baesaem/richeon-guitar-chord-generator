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
    /* 1·2번 괄호. 줄 머리의 [V:1] 같은 줄 안 지시 뒤에 오기도 한다 —
       「혜화동」은 「[V:1] [1」이라 1번 괄호를 못 알아봐 두 번째 돌 때도
       1번 괄호 9마디를 쳐서, 97마디가 106마디로 셈해졌다 */
    const v = text.match(/^((?:\[[A-Za-z]:[^\]]*\]\s*)*)\[(\d+)[-,.\d]*\s*/);
    if (v) {
      volta = +v[2];
      text = v[1] + text.slice(v[0].length);
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
