"use client";

import { abcOrders } from "./abcOrder";
import { saveAbc, setAbcFollow } from "./abcStore";
import { fixBeats, putScore, putSheetImage, readSheetChords } from "./api";
import { msczToAbc } from "./msczToAbc";
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
  return null;
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
): Promise<ScoreAtRegisterResult> {
  const notes: string[] = [];
  let cur = result;

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
    // 종이 악보: 그림을 붙이고, AI에게 마디마다의 코드 글자를 읽힌다
    try {
      cur = await putSheetImage(cur.id, file);
      notes.push("악보 그림을 붙였습니다");
      const got = await readSheetChords(cur.id);
      cur = got.result;
      abc = got.abc;
      notes.push(`코드를 읽었습니다 (${got.bars}마디 중 ${got.chordBars}마디에 코드)`);
    } catch (e) {
      notes.push(`종이 악보 읽기 실패: ${(e as Error).message}`);
      return { result: cur, notes };
    }
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
    if (Math.abs(have - played) / played > 0.05) {
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
  return { result: cur, notes };
}
