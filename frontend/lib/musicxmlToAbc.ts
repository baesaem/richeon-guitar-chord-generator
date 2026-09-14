/**
 * MusicXML(.musicxml·.mxl, 그리고 서버 OMR이 종이 악보에서 읽은 것) → ABC.
 *
 * 뮤즈스코어 변환(msczToAbc)과 같은 마디 모델(Measure/NoteEv)을 만들어 같은
 * ABC 쓰기(measuresToAbc)를 탄다 — 파일 형식만 다르고 그리는 악보는 같아야
 * 한다. 첫 성부만 읽는다(OMR은 뒤 성부에 쉼표를 지어낸다).
 *
 * 되돌이표·1·2번 괄호·세뇨·코다·D.S.는 barline/ending/direction에서 옮긴다.
 * OMR 결과에는 대개 없다 — 그때는 앱의 AI 그림 읽기(되돌이 읽기)가 채운다.
 */

import { unzipSync } from "fflate";

import { measuresToAbc, type Measure, type NoteEv } from "./msczToAbc";

/** 뮤즈스코어 tpc: C=14, 5도권으로 한 칸씩. ♯는 +7, ♭은 -7 */
const TPC_BASE: Record<string, number> = { C: 14, D: 16, E: 18, F: 13, G: 15, A: 17, B: 19 };
const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MusicXML kind → 뮤즈스코어식 코드 꼬리 이름 */
const KIND_NAME: Record<string, string> = {
  major: "", minor: "m", dominant: "7", "major-seventh": "maj7", "minor-seventh": "m7",
  "dominant-ninth": "9", "major-sixth": "6", "minor-sixth": "m6", "suspended-fourth": "sus4",
  "suspended-second": "sus2", augmented: "aug", diminished: "dim", "diminished-seventh": "dim7",
  "half-diminished": "m7b5", "augmented-seventh": "aug7", "major-minor": "mMaj7", "dominant-11th": "11",
  "dominant-13th": "13", "major-ninth": "maj9", "minor-ninth": "m9", "minor-11th": "m11", power: "5",
  none: "", other: "",
};

function text(el: Element | null | undefined, sel: string): string | null {
  const c = el?.querySelector(sel);
  return c?.textContent ?? null;
}

/** 파일 바이트 → MusicXML 글. .mxl은 zip이다 */
export function loadMusicXml(data: Uint8Array | string, fileName: string): string {
  if (typeof data === "string") return data;
  if (/\.mxl$/i.test(fileName) || (data[0] === 0x50 && data[1] === 0x4b)) {
    const files = unzipSync(data);
    const name =
      Object.keys(files).find((n) => /^[^/]+\.xml$/i.test(n) && !/^META-INF/.test(n)) ??
      Object.keys(files).find((n) => /\.(xml|musicxml)$/i.test(n) && !/^META-INF/.test(n));
    if (!name) throw new Error("MusicXML 압축 파일 안에 악보가 없습니다");
    // 어떤 .mxl(Audiveris가 만든 것)은 fflate가 빈 내용으로 푼다 — 풀어서 넣게 안내
    if (!files[name].length)
      throw new Error("이 .mxl은 풀지 못합니다 — 뮤즈스코어에서 .musicxml(압축 없음)로 저장해 넣어 주세요");
    return new TextDecoder().decode(files[name]);
  }
  return new TextDecoder().decode(data);
}

function parseDoc(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("MusicXML을 읽지 못했습니다");
  if (doc.documentElement.tagName === "score-timewise")
    throw new Error("timewise MusicXML은 아직 읽지 못합니다");
  return doc;
}

export interface XmlPart {
  index: number;
  name: string;
  lyrics: number;
}

/** 파트 목록 — 혼성 악보에서 멜로디를 고르게 */
export function musicxmlParts(data: Uint8Array | string, fileName: string): XmlPart[] {
  const doc = parseDoc(loadMusicXml(data, fileName));
  const names = new Map<string, string>();
  doc.querySelectorAll("part-list > score-part").forEach((sp) => {
    names.set(sp.getAttribute("id") ?? "", text(sp, "part-name")?.trim() ?? "");
  });
  const parts = [...doc.querySelectorAll("score-partwise > part")];
  if (parts.length < 2) return [];
  return parts.map((p, i) => {
    const lyrics = p.querySelectorAll("lyric").length;
    const base = names.get(p.getAttribute("id") ?? "") || "보표";
    return { index: i, name: `${i + 1}번 · ${base}${lyrics ? ` — 가사 ${lyrics}개(멜로디)` : ""}`, lyrics };
  });
}

/** direction/words 글자와 기호를 ABC 표식으로 */
function marksOf(m: Element): string {
  let out = "";
  m.querySelectorAll("direction").forEach((d) => {
    if (d.querySelector("segno")) out += "!segno!";
    if (d.querySelector("coda")) out += "!coda!";
    const w = (text(d, "words") ?? "").trim();
    if (/^to\s*coda/i.test(w)) out += "!coda!";
    else if (/fine/i.test(w) && !/al\s*fine/i.test(w)) out += "!fine!";
    else if (/D\.?\s*S\.?/i.test(w)) out += /coda/i.test(w) ? "!D.S.alcoda!" : "!D.S.alfine!";
    else if (/D\.?\s*C\.?/i.test(w)) out += /coda/i.test(w) ? "!D.C.alcoda!" : "!D.C.alfine!";
  });
  return out;
}

/** 파트 하나를 마디 모델로. 첫 성부만 */
function parsePart(part: Element): { measures: Measure[]; sigN: number; sigD: number; firstKey: number; octaveDown: boolean } {
  let divisions = 1;
  let sigN = 4;
  let sigD = 4;
  let firstKey = 0;
  let sawKey = false;
  let octaveDown = false;
  const measures: Measure[] = [];
  part.querySelectorAll(":scope > measure").forEach((m) => {
    const attrs = m.querySelector(":scope > attributes");
    let keysig: number | null = null;
    if (attrs) {
      const d = text(attrs, "divisions");
      if (d) divisions = +d;
      const b = text(attrs, "time > beats");
      const bt = text(attrs, "time > beat-type");
      if (b && bt) {
        sigN = +b;
        sigD = +bt;
      }
      const f = text(attrs, "key > fifths");
      if (f !== null) {
        keysig = +f;
        if (!sawKey) {
          firstKey = +f;
          sawKey = true;
        }
      }
      // 기타 음자리표(높은음자리표 아래 8) — 종이 악보의 자리 그대로 적는다
      const clef = attrs.querySelector("clef");
      if (clef && text(clef, "sign") === "G" && text(clef, "clef-octave-change") === "-1") octaveDown = true;
    }
    const events: NoteEv[] = [];
    let pendingHarmony: NoteEv["harmony"] = null;
    for (const el of [...m.children]) {
      if (el.tagName === "backup") break; // 첫 성부만
      if (el.tagName === "harmony") {
        const step = text(el, "root > root-step") ?? "C";
        const alter = +(text(el, "root > root-alter") ?? 0);
        const kindEl = el.querySelector("kind");
        const kindText = kindEl?.getAttribute("text");
        const kind = kindEl?.textContent?.trim() ?? "major";
        let name = kindText !== null && kindText !== undefined ? kindText : (KIND_NAME[kind] ?? kind);
        el.querySelectorAll("degree").forEach((dg) => {
          const v = text(dg, "degree-value");
          const t = text(dg, "degree-type");
          if (v && t === "add") name += `add${v}`;
        });
        const bstep = text(el, "bass > bass-step");
        const balter = +(text(el, "bass > bass-alter") ?? 0);
        pendingHarmony = {
          root: String(TPC_BASE[step] + 7 * alter),
          name,
          base: bstep ? String(TPC_BASE[bstep] + 7 * balter) : undefined,
        };
        continue;
      }
      if (el.tagName !== "note") continue;
      if (el.querySelector(":scope > chord")) {
        // 화음의 둘째 음 — 앞 음표에 얹는다
        const last = events[events.length - 1];
        const p = el.querySelector("pitch");
        if (last && last.type === "note" && p) {
          const step = text(p, "step") ?? "C";
          const alter = +(text(p, "alter") ?? 0);
          const oct = +(text(p, "octave") ?? 4);
          last.notes.push({
            midi: (oct + 1) * 12 + STEP_SEMI[step] + alter,
            tpc: TPC_BASE[step] + 7 * alter,
            tie: !!el.querySelector("tie[type='start']"),
            fret: null,
            string: null,
          });
        }
        continue;
      }
      if (el.querySelector(":scope > grace")) continue;
      const dur = +(text(el, "duration") ?? 0);
      const units = (dur / divisions) * 4; // 16분음표 수
      const tm = el.querySelector("time-modification");
      const tuplet = tm
        ? +(text(tm, "normal-notes") ?? 1) / +(text(tm, "actual-notes") ?? 1)
        : undefined;
      if (el.querySelector(":scope > rest")) {
        events.push({ type: "rest", units, notes: [], tuplet, lyric: null, lyric2: null, harmony: pendingHarmony });
      } else {
        const p = el.querySelector("pitch");
        const step = text(p, "step") ?? "C";
        const alter = +(text(p, "alter") ?? 0);
        const oct = +(text(p, "octave") ?? 4);
        const verses: (string | null)[] = [];
        el.querySelectorAll(":scope > lyric").forEach((ly) => {
          const no = Math.max(0, +(ly.getAttribute("number") ?? 1) - 1);
          let t = ly.querySelector("text")?.textContent ?? "";
          const syl = text(ly, "syllabic");
          if (syl === "begin" || syl === "middle") t += "-";
          verses[no] = t;
        });
        events.push({
          type: "note",
          units,
          notes: [
            {
              midi: (oct + 1) * 12 + STEP_SEMI[step] + alter,
              tpc: TPC_BASE[step] + 7 * alter,
              tie: !!el.querySelector("tie[type='start']"),
              fret: null,
              string: null,
            },
          ],
          tuplet,
          lyric: verses[0] ?? null,
          lyric2: verses[1] ?? null,
          verses,
          harmony: pendingHarmony,
        });
      }
      pendingHarmony = null;
    }
    let startRepeat = false;
    let endRepeat = false;
    let volta: string | null = null;
    m.querySelectorAll(":scope > barline").forEach((b) => {
      const rep = b.querySelector("repeat")?.getAttribute("direction");
      if (rep === "forward") startRepeat = true;
      if (rep === "backward") endRepeat = true;
      const end = b.querySelector("ending");
      if (end && end.getAttribute("type") === "start") volta = end.getAttribute("number") ?? volta;
    });
    measures.push({ events, keysig, startRepeat, endRepeat, volta, marks: marksOf(m) });
  });
  return { measures, sigN, sigD, firstKey, octaveDown };
}

/** MusicXML → ABC. staff는 파트 차례(0부터) */
export function musicxmlToAbc(data: Uint8Array | string, fileName: string, staff = 0): string {
  const doc = parseDoc(loadMusicXml(data, fileName));
  const parts = [...doc.querySelectorAll("score-partwise > part")];
  if (!parts.length) throw new Error("악보에서 파트를 찾지 못했습니다");
  if (!parts[staff]) throw new Error(`파트가 ${parts.length}개뿐입니다`);
  const title =
    text(doc.documentElement, "work > work-title")?.trim() ||
    text(doc.documentElement, "movement-title")?.trim() ||
    "";
  const tempo = doc.querySelector("sound[tempo]")?.getAttribute("tempo");
  const bpm = tempo ? Math.round(+tempo) : 0;
  const own = parsePart(parts[staff]);
  /* 되돌이·괄호·세뇨·코다는 첫 파트에만 적히기도 한다 — 뮤즈스코어 변환과 같게 첫
     파트 것을 빌린다 */
  if (staff > 0) {
    const first = parsePart(parts[0]).measures;
    own.measures.forEach((mm, j) => {
      const f = first[j];
      if (!f) return;
      if (!mm.startRepeat) mm.startRepeat = f.startRepeat;
      if (!mm.endRepeat) mm.endRepeat = f.endRepeat;
      if (mm.volta === null) mm.volta = f.volta;
      if (!mm.marks) mm.marks = f.marks;
      if (!mm.events.some((e) => e.harmony?.root)) {
        const chords = f.events.filter((e) => e.harmony?.root);
        chords.forEach((c, k) => {
          const at = Math.floor((mm.events.length * k) / Math.max(chords.length, 1));
          const ev = mm.events[at];
          if (ev && !ev.harmony) ev.harmony = c.harmony;
        });
      }
    });
  }
  if (!own.measures.some((mm) => mm.events.length)) throw new Error("악보에서 마디를 찾지 못했습니다");
  /* MusicXML은 적힌 음높이를 그대로 담는다(옥타브 음자리표 포함) — 뮤즈스코어와 달리
     올릴 것이 없다. 8vb 음자리표면 이미 종이 자리다 */
  return measuresToAbc(own.measures, {
    title,
    bpm,
    sigN: own.sigN,
    sigD: own.sigD,
    firstKey: own.firstKey,
    up: 0,
    tab: false,
  });
}
