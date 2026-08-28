"use client";

/**
 * 악보 글꼴(Bravura)의 글자들.
 *
 * 음표를 선과 타원으로 흉내 내면 아무리 손봐도 인쇄된 악보를 못
 * 따라간다. 악보 프로그램은 모두 전용 글꼴에서 모양을 가져다 놓고
 * 오선·기둥·덧줄 같은 **선만** 직접 긋는다. 우리도 그렇게 한다.
 *
 * SMuFL은 악보 글자의 자리를 정해 둔 표준이다. 글자 하나의 크기(em)가
 * **오선 네 칸**이라, 칸 간격이 정해지면 글자 크기도 따라 정해진다.
 */

/** 글자 크기 = 오선 칸 간격 × 4 (SMuFL 규약) */
export const fontSize = (staffSpace: number) => staffSpace * 4;

export const GLYPH = {
  clefG: "\uE050",
  /** 한 옥타브 아래로 읽는 높은음자리표. 기타 악보가 쓰는 것 */
  clefG8vb: "\uE052",

  noteWhole: "\uE0A2",
  noteHalf: "\uE0A3",
  noteBlack: "\uE0A4",
  dot: "\uE1E7",

  flag8Up: "\uE240",
  flag8Down: "\uE241",
  flag16Up: "\uE242",
  flag16Down: "\uE243",
  flag32Up: "\uE244",
  flag32Down: "\uE245",

  flat: "\uE260",
  natural: "\uE261",
  sharp: "\uE262",

  restWhole: "\uE4E3",
  restHalf: "\uE4E4",
  restQuarter: "\uE4E5",
  rest8: "\uE4E6",
  rest16: "\uE4E7",

  tuplet3: "\uE883",
} as const;

/** 박자표 숫자 0~9 */
export const timeSigDigit = (d: number) =>
  String.fromCodePoint(0xe080 + Math.min(Math.max(d, 0), 9));

/** 음표 값(4=온음표 … 0.25=16분음표) → 머리 글자 */
export function headGlyph(value: number): string {
  if (value >= 4) return GLYPH.noteWhole;
  if (value >= 2) return GLYPH.noteHalf;
  return GLYPH.noteBlack;
}

/** 꼬리. 4분음표보다 짧을 때만 붙는다 */
export function flagGlyph(value: number, up: boolean): string | null {
  if (value > 0.5) return null;
  if (value > 0.25) return up ? GLYPH.flag8Up : GLYPH.flag8Down;
  if (value > 0.125) return up ? GLYPH.flag16Up : GLYPH.flag16Down;
  return up ? GLYPH.flag32Up : GLYPH.flag32Down;
}

export function restGlyph(value: number): string {
  if (value >= 4) return GLYPH.restWhole;
  if (value >= 2) return GLYPH.restHalf;
  if (value >= 1) return GLYPH.restQuarter;
  if (value >= 0.5) return GLYPH.rest8;
  return GLYPH.rest16;
}

/**
 * 쉼표가 걸리는 오선 자리(맨 윗줄에서 몇 칸 아래).
 *
 * 온쉼표는 둘째 줄에 매달고, 2분쉼표는 가운뎃줄 위에 얹는다. 나머지는
 * 가운뎃줄에 놓는다 — 악보의 오랜 약속이다.
 */
export function restLine(value: number): number {
  if (value >= 4) return 1;
  return 2;
}

/**
 * 음표 머리의 폭(오선 칸 단위). 기둥을 머리 가장자리에 붙일 때 쓴다.
 * Bravura의 검은 머리는 1.18칸, 온음표는 1.76칸이다.
 */
export function headWidth(value: number): number {
  return value >= 4 ? 1.76 : 1.18;
}

/** 글꼴이 없을 때를 대비한 대체 — 네모가 뜨느니 아무것도 안 뜨는 편이 낫다 */
export const FONT_STACK = '"Bravura", "Noto Music", sans-serif';
