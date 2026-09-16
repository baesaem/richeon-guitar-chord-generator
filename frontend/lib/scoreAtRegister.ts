"use client";

import { abcOrders } from "./abcOrder";
import { getAbc, saveAbc, setAbcFollow, setAbcTabScore } from "./abcStore";
import { fixBeats, omrScore, putScore, putSheetImage, readSheetChords } from "./api";
import { abcMeasures } from "./abcOrder";
import { applyBarChords, applyBarMarks, type BarMarks } from "./abcChordSwap";
import { musicxmlToAbc } from "./musicxmlToAbc";
import { addBarLyrics } from "./abcLyrics";
import { msczParts, msczToAbc, msczToTab } from "./msczToAbc";
import type { AnalysisResult } from "./types";

/**
 * 음원을 등록할 때 악보를 함께 넣으면, 분석이 끝나는 자리에서 그 악보를
 * 곡에 싣고 **코드가 악보를 따르게** 해 둔다.
 *
 * 음원만 듣고 딴 코드는 틀리는 데가 많다. 악보가 있는데도 등록한 뒤에
 * 따로 붙이고 「악보 따르기」를 켜야 했다 — 그 세 단계를 등록 한 번에
 * 끝낸다. 분석 자체는 그대로 돈다(박·가사·소리 자리는 음원에서 재야
 * 한다). 코드만 악보 것이 된다.
 *
 * 종이 악보(PDF·사진)도 받는다. 그림은 그대로 붙여 커서가 지나가게
 * 하고, 코드는 AI가 마디마다 읽어 코드만 적힌 ABC로 만든다 — 음표와
 * 달리 코드 글자와 마디 번호는 잘 읽힌다.
 *
 * 덤으로 마디 수를 맞춘다. 슬로우 록(12비트)처럼 셋잇단을 박으로 세어
 * 마디가 세 배로 늘어난 곡은, 악보의 마디 수와 견주어 보면 몇 배로
 * 어긋났는지 바로 드러난다 — 「광화문 연가」는 악보 58마디에 음원
 * 174마디로 나와 세 배였다.
 */

/** 등록 화면이 받는 악보 파일 종류 */
export const SCORE_ACCEPT =
  ".abc,.txt,.mscz,.mscx,.xml,.musicxml,.mxl,.pdf,.png,.jpg,.jpeg,.webp,image/*";

const ABC_KINDS = /\.(abc|txt)$/i;
const MSCZ_KINDS = /\.(mscz|mscx)$/i;
const XML_KINDS = /\.(xml|musicxml|mxl)$/i;
/** 종이 악보 — 인쇄물을 찍거나 뽑은 것. 그림 그대로 붙이고 코드는 AI가 읽는다 */
const IMAGE_KINDS = /\.(pdf|png|jpe?g|webp)$/i;

/** 파일에서 ABC를 얻는다. 얻을 수 없는 종류면 null */
async function toAbc(file: File, staff = 0): Promise<string | null> {
  const name = file.name;
  if (ABC_KINDS.test(name)) return (await file.text()).trim() || null;
  if (MSCZ_KINDS.test(name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return msczToAbc(bytes, name, staff);
  }
  if (XML_KINDS.test(name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return musicxmlToAbc(bytes, name, staff);
  }
  return null;
}

/**
 * 그림에서 읽은 코드(코드만 적힌 ABC)를 OMR 악보(음표는 있고 코드는 없는 ABC)에
 * 마디 번호대로 얹는다. 두 셈의 마디 수가 다르면 앞에서부터 맞는 데까지만.
 */
function chordsInto(omrAbc: string, chordAbc: string): { abc: string; put: number } {
  const byBar: Record<number, string[]> = {};
  let put = 0;
  try {
    abcMeasures(chordAbc).forEach((m, i) => {
      const names = [...m.text.matchAll(/"([^"^_<>@][^"]*)"/g)].map((x) => x[1].trim());
      if (names.length) {
        byBar[i] = names;
        put++;
      }
    });
  } catch {
    return { abc: omrAbc, put: 0 };
  }
  if (!put) return { abc: omrAbc, put: 0 };
  return { abc: applyBarChords(omrAbc, byBar), put };
}

/**
 * 코드용 ABC(AI가 읽은 것)에서 마디마다의 되돌이 표시를 뽑는다 — 음표 악보에 옮기려고.
 * 도돌이 시작·끝, 괄호 번호, 세뇨·코다·To Coda·D.S. 같은 글자.
 */
function marksOf(chordAbc: string): { byBar: Record<number, BarMarks>; count: number } {
  const byBar: Record<number, BarMarks> = {};
  let count = 0;
  try {
    abcMeasures(chordAbc).forEach((m, i) => {
      const marks = [...m.text.matchAll(/![^!]+!|"To Coda"/g)].map((x) => x[0]);
      const one: BarMarks = {};
      if (m.startRepeat) one.start = true;
      if (m.endRepeat) one.end = true;
      if (m.volta) one.volta = m.volta;
      if (marks.length) one.marks = marks;
      if (Object.keys(one).length) {
        byBar[i] = one;
        count++;
      }
    });
  } catch {
    return { byBar: {}, count: 0 };
  }
  return { byBar, count };
}

/** 음원의 마디 수. 첫 박마다 마디가 하나다 */
function audioBars(result: AnalysisResult): number {
  return result.beats.filter((b) => b.beat === 1).length;
}

/**
 * 음원 마디 수를 악보의 연주 마디 수에 맞추는 배율을 고른다.
 *
 * 배율은 1 · 1/2 · 1/3 · 2 · 3 가운데 하나다. 박 찾기가 틀리는 길이 그
 * 다섯뿐이다 — 8분음표를 박으로 세거나(2), 셋잇단을 박으로 세거나(3),
 * 반대로 한 마디를 한 박으로 세거나. 배율 1이 이미 잘 맞으면 손대지
 * 않고, 다른 배율이 뚜렷이 나을 때만 고른다. 전주·후주가 악보에 없어
 * 마디 수가 조금 다른 것은 배율이 아니다.
 */
function pickScale(
  audio: number,
  score: number,
): "half" | "third" | "double" | "triple" | null {
  if (audio < 4 || score < 4) return null;
  const options = [
    { mode: null, f: 1 },
    { mode: "half", f: 0.5 },
    { mode: "third", f: 1 / 3 },
    { mode: "double", f: 2 },
    { mode: "triple", f: 3 },
  ] as const;
  const off = (f: number) => Math.abs(audio * f - score) / score;
  const asIs = off(1);
  let best: (typeof options)[number] = options[0];
  for (const o of options) if (off(o.f) < off(best.f)) best = o;
  // 지금 그대로가 그럭저럭 맞으면(1/4 안) 건드리지 않는다.
  // 다른 배율은 뚜렷이 가까워야 한다 — 전주 몇 마디 차이로는 안 바꾼다.
  if (asIs < 0.25 || off(best.f) > 0.25) return null;
  return best.mode;
}

/**
 * 악보 붙이기 진행 — 기다리는 동안 작업 중 화면(Working)에 단계·진행 막대로
 * 보인다(강사님: 「서버 작업 중 기다릴 경우 진행 과정 인디케이터 화면」).
 */
export interface AttachProgress {
  steps: string[];
  /** 지금 단계(0부터) */
  index: number;
  /** 지금 하는 일 한 줄 */
  note?: string;
  /** 이 단계가 보통 몇 초 걸리나 — 막대를 시간으로 조금씩 밀 때 쓴다 */
  expectSec: number;
  /** AI 읽기: 끝난 수 / 전체 수(검증에서 다시 읽으면 전체가 는다) */
  done?: number;
  total?: number;
}

export interface ScoreAtRegisterResult {
  result: AnalysisResult;
  /** 무슨 일이 있었나. 알림창에 그대로 띄운다 */
  notes: string[];
}

export async function attachScoreAfterAnalysis(
  result: AnalysisResult,
  file: File,
  /** 혼성 악보에서 쓸 보표(0부터). 노래·기타·타브 중 어느 것이 멜로디인지는 사람이 고른다 */
  staff = 0,
  /** 단계마다 진행을 알린다 — 작업 중 화면이 단계·진행 막대로 보인다 */
  onProgress?: (p: AttachProgress) => void,
): Promise<ScoreAtRegisterResult> {
  const notes: string[] = [];
  let cur = result;
  const isImage = IMAGE_KINDS.test(file.name) || file.type.startsWith("image/");
  const STEPS = isImage
    ? ["악보 그림 붙이기", "음표 읽기(종이 악보 인식)", "AI가 코드·가사 읽기", "마디 맞추고 악보 싣기"]
    : ["악보 읽어 붙이기", "마디 맞추고 악보 싣기"];
  const step = (index: number, expectSec: number, more: Partial<AttachProgress> = {}) =>
    onProgress?.({ steps: STEPS, index, expectSec, ...more });
  if (!isImage) step(0, 6, { note: "악보 파일을 읽는 중" });

  // ① 뮤즈스코어·MusicXML은 서버에도 붙인다 — 멜로디 화면과 가사 정렬이
  //    그쪽을 쓴다. 서버가 거절해도 아래 ABC 길은 그대로 간다.
  if (MSCZ_KINDS.test(file.name) || XML_KINDS.test(file.name)) {
    try {
      cur = await putScore(cur.id, file, staff);
      notes.push("악보를 붙였습니다");
    } catch (e) {
      notes.push(`악보 붙이기 실패: ${(e as Error).message}`);
    }
  }

  // ② 코드는 ABC로 따른다
  let abc: string | null = null;
  if (IMAGE_KINDS.test(file.name) || file.type.startsWith("image/")) {
    // 종이 악보: 그림을 붙인다 — 그 마디 자리를 아래 음표 읽기가 쓴다
    step(0, 10, { note: "악보 그림에서 마디선을 찾는 중" });
    try {
      cur = await putSheetImage(cur.id, file);
      notes.push("악보 그림을 붙였습니다");
    } catch (e) {
      notes.push(`종이 악보 붙이기 실패: ${(e as Error).message}`);
      return { result: cur, notes };
    }
    /*
     * 음표는 OMR(Audiveris)로 읽는다 — 디지털 악보 없이 종이 악보만으로 멜로디
     * 악보를 얻는 길(강사님: 「디지털 악보를 구하기 어렵다」). 서버가 마디를 그림
     * 마디 자리로 다시 나누고, 글자가 든 PDF면 코드·가사·빠르기도 글자 그대로 넣는다
     * (「동해의꿈」). 서버에 인식기가 없거나 실패하면 코드만 적힌 악보로 간다.
     */
    let omrAbc: string | null = null;
    let textChords = false;
    step(1, 90, { note: "음표를 읽는 중 — 보통 1~2분 걸립니다" });
    try {
      const omr = await omrScore(file, cur.id);
      omrAbc = musicxmlToAbc(omr.xml, "omr.musicxml", 0);
      textChords = (omr.text?.chord_bars ?? 0) > 0;
      const t = omr.text;
      /* 검증(강사님: 「이런 일이 반복되는데 검증 과정을 추가해」) — 음표 인식이 센
         마디 수와 그림에서 찾은 마디 상자 수가 다르면 어느 한쪽이 틀린 것이다.
         「가슴 속에 사는 사람아」는 상자가 106, 음표는 94였다. 조용히 넘기지 않고 적는다 */
      const boxes = ((cur.sheet as { bars?: unknown[] } | null)?.bars ?? []).length;
      if (boxes && omr.measures && boxes !== omr.measures)
        notes.push(
          `⚠ 검증: 그림 마디 ${boxes} ≠ 음표 마디 ${omr.measures} — 코드·가사 자리가 어긋날 수 있습니다. ` +
            "배경악보 커서가 틀리면 「다시 읽기」로 그림을 다시 나눠 주세요",
        );
      notes.push(
        `악보의 음표를 읽었습니다 — ${omr.measures}마디` +
          (omr.aligned ? " (그림 마디 자리에 맞춤)" : "") +
          (t?.chord_bars ? ` · PDF 글자에서 코드 ${t.chord_bars}마디` : "") +
          (t?.lyric_bars ? ` · 가사 ${t.lyric_bars}마디` : "") +
          (t?.tempo ? ` · ♩=${t.tempo}` : ""),
      );
      // 서버에도 붙인다 — 멜로디 화면과 가사 정렬이 그쪽 마디를 쓴다
      try {
        const xmlFile = new File([omr.xml], "omr.musicxml", { type: "application/xml" });
        cur = await putScore(cur.id, xmlFile, 0);
      } catch {
        // 서버 쪽은 없어도 ABC 길은 간다
      }
    } catch (e) {
      notes.push(`음표 읽기는 건너뜀 (${(e as Error).message})`);
    }
    // 코드 — PDF 글자로 얻었으면 그대로, 아니면 AI가 그림에서 읽는다(1분쯤).
    // 글자가 없는 그림 PDF(「백일몽」)는 가사·제목도 이때 함께 읽는다
    let chordAbc: string | null = null;
    let sheetLyrics: Record<string, string[]> = {};
    let sheetTitle = "";
    if (!textChords) {
      step(2, 70, { note: "두 쪽씩 두 번 읽어 맞춰 봅니다" });
      try {
        const got = await readSheetChords(cur.id, (p) =>
          step(2, 35, {
            note:
              (p.note || "두 쪽씩 두 번 읽어 맞춰 봅니다") +
              (p.total ? ` · ${p.done}/${p.total}` : ""),
            done: p.done,
            total: p.total,
          }),
        );
        cur = got.result;
        chordAbc = got.abc;
        sheetLyrics = got.lyrics ?? {};
        sheetTitle = got.title ?? "";
        const ly = Object.keys(sheetLyrics).length;
        notes.push(
          `코드를 읽었습니다 (${got.bars}마디 중 ${got.chordBars}마디에 코드)` +
            (ly ? ` · 가사 ${ly}마디` : ""),
        );
        // 검증 — 두 번 읽어 맞춰 보고 다시 읽은 곳이 있으면 알린다
        if (got.check?.length) notes.push(`검증: ${got.check.join(" · ")}`);
        else notes.push("검증: 두 번 읽은 코드·가사가 서로 맞았습니다");
      } catch (e) {
        notes.push(`코드 읽기 실패: ${(e as Error).message}`);
        if (!omrAbc) return { result: cur, notes };
      }
    }
    if (omrAbc && chordAbc) {
      const merged = chordsInto(omrAbc, chordAbc);
      abc = merged.abc;
      if (merged.put) notes.push(`그림의 코드 ${merged.put}마디를 얹었습니다`);
      /* 되돌이도 그림 것을 따른다 — 음표 인식은 도돌이표를 놓치고 2번 괄호를
         1번으로 적기도 한다(「가슴 속에 사는 사람아」). 그러면 펼친 마디 수가
         틀려 박이 잘못 깔린다. 없는 표시만 보탠다 */
      const marks = marksOf(chordAbc);
      if (marks.count) {
        abc = applyBarMarks(abc, marks.byBar);
        notes.push(`그림의 되돌이 표시 ${marks.count}마디를 옮겼습니다`);
      }
    } else {
      abc = omrAbc ?? chordAbc;
    }
    // 그림에서 읽은 가사 — 음표가 있는 악보(OMR)에만 넣는다. 마디 번호는 1부터
    if (omrAbc && abc && Object.keys(sheetLyrics).length) {
      const byBar: Record<number, string[]> = {};
      for (const [k, v] of Object.entries(sheetLyrics)) byBar[+k - 1] = v;
      abc = addBarLyrics(abc, byBar);
    }
    if (abc && sheetTitle && /^T:제목 없음$/m.test(abc))
      abc = abc.replace(/^T:제목 없음$/m, `T:${sheetTitle}`);
  } else {
    try {
      abc = await toAbc(file, staff);
    } catch (e) {
      notes.push(`악보를 읽지 못했습니다: ${(e as Error).message}`);
    }
  }
  if (!abc) {
    if (XML_KINDS.test(file.name))
      notes.push("MusicXML은 코드 따르기를 아직 못 합니다 — .mscz나 .abc를 넣어 주세요");
    return { result: cur, notes };
  }

  // ③ 마디 수를 맞춘다. 악보의 연주 차례(도돌이 펼친 것)와 견준다
  step(STEPS.length - 1, 8, { note: "음원의 마디·박을 악보에 맞추는 중" });
  const orders = abcOrders(abc);
  const played = orders?.withJump.length ?? 0;
  const mode = pickScale(audioBars(cur), played);
  if (mode) {
    const label = { half: "×2", third: "×3", double: "÷2", triple: "÷3" }[mode];
    try {
      cur = await fixBeats(cur.id, mode);
      notes.push(
        `악보 ${played}마디에 맞춰 마디 ${label} (음원 ${audioBars(cur)}마디)`,
      );
    } catch (e) {
      notes.push(`마디 ${label} 실패: ${(e as Error).message}`);
    }
  }
  /*
   * 그래도 마디 수가 악보와 5% 넘게 다르면 악보 마디 수에 맞춰 고르게
   * 다시 깐다. 박 찾기가 실제의 2.26배처럼 정수로 돌아오지 않는 배율로
   * 잡히는 일이 있다 — 그때는 어떤 ×2·×3으로도 못 맞춘다. 악보의
   * 펼친 마디 수로 곡 길이를 나누면 한 마디의 길이가 나온다.
   */
  if (played >= 8) {
    const have = audioBars(cur);
    // 한 마디만 달라도 맞춘다 — 그 한 마디가 곡 전체에 걸쳐 벌어지면
    // 커서가 갈수록 앞서 나간다
    if (have !== played) {
      try {
        cur = await fixBeats(cur.id, "fit", played);
        notes.push(`악보 ${played}마디에 맞춰 박을 고르게 다시 깔았습니다`);
      } catch (e) {
        notes.push(`마디 맞추기 실패: ${(e as Error).message}`);
      }
    }
  }

  // ④ 악보를 싣고 코드가 악보를 따르게 한다
  saveAbc(cur.id, abc, 0);
  setAbcFollow(cur.id, true);
  notes.push("코드는 악보를 따릅니다");

  /*
   * ⑤ 타브 보표가 들어 있으면 타브 화면은 그것을 쓴다.
   *
   * 멜로디 음에서 프렛 숫자를 만들면 한 줄짜리 단선율이 되어, 편곡자가
   * 적은 손가락 뜯기와 전혀 다른 것이 나온다. 파일 안에 진짜 타브가
   * 있는데 그것을 두고 지어낼 이유가 없다.
   */
  if (!MSCZ_KINDS.test(file.name)) {
    /* 뮤즈스코어가 아닌 악보에는 타브 보표가 없다. 앞서 붙여 둔 것을
       그대로 두면 새 악보와 짝이 맞지 않는 타브가 남는다 */
    setAbcTabScore(cur.id, null);
  } else {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parts = msczParts(bytes, file.name);
      /* 타브 보표가 있으면 그것을, 없으면 기타 파트를 쓴다(오선뿐이면 음높이로
         줄·프렛을 매긴다). 맨 끝 파트로 떨어지면 드럼이 타브가 되기도 했다 —
         「나는 반딧불」은 피아노·기타·베이스·드럼 차례였다 */
      const tabPart =
        parts.find((p) => /타브|tab/i.test(p.name)) ??
        parts.find((p) => p.index !== staff && /기타|guitar/i.test(p.name)) ??
        (parts.length > 1 ? parts[parts.length - 1] : null);
      if (tabPart && tabPart.index !== staff) {
        /* 「악보의 타브 쓰기」는 강사님이 이 곡에 고른 것이다. 고친 악보를
           다시 붙였다고 저절로 꺼지면 타브 화면이 「제공하지 않습니다」로 돌아간다 */
        const own = !!getAbc(cur.id)?.tabScore?.ownFrets;
        setAbcTabScore(cur.id, {
          ...msczToTab(bytes, file.name, tabPart.index),
          ...(own ? { ownFrets: true } : {}),
        });
        notes.push(`타브는 「${tabPart.name}」에서 가져옵니다`);
      } else {
        setAbcTabScore(cur.id, null);
      }
    } catch {
      setAbcTabScore(cur.id, null);
    }
  }
  return { result: cur, notes };
}
