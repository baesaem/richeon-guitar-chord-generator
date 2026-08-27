/**
 * 기타 운지 생성 (CAGED 기반).
 *
 * 코드 사전을 통째로 들고 오는 대신, 오픈 코드 몇 개를 표로 두고
 * 나머지는 E폼·A폼 바레를 해당 프렛으로 옮겨서 만든다.
 * M4부터 백엔드가 7th·sus·dim까지 내므로 폼도 그만큼 갖춘다.
 */

const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5,
  "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
};

export interface Voicing {
  /** 6개. 낮은 E(6번줄)부터 순서대로. -1 = 뮤트, 0 = 개방현 */
  frets: number[];
  /** 6개. 짚는 손가락 번호(1=검지 … 4=새끼). 0 = 안 짚음 */
  fingers: number[];
  /** 바레: 해당 프렛을 fromString~toString(0=6번줄) 까지 누른다 */
  barre?: { fret: number; fromString: number; toString: number };
  /** 다이어그램 맨 위에 표시할 시작 프렛 */
  baseFret: number;
}

interface Shape {
  frets: number[];
  fingers: number[];
}

const OPEN_SHAPES: Record<string, Shape> = {
  C:  { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  A:  { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  G:  { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  E:  { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  D:  { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  Am: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  Dm: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  // 7th·maj7·m7·sus4의 1포지션 오픈 폼. 이게 없으면 E7이 12프렛
  // 바레로 나온다 — 수업 유인물은 전부 오픈 폼으로 가르친다.
  C7:    { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  A7:    { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  B7:    { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  D7:    { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  E7:    { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  G7:    { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  Am7:   { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  Dm7:   { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  Em7:   { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  Cmaj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  Amaj7: { frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  Dmaj7: { frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 2, 3] },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  Gmaj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] },
  Fmaj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  Asus4: { frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  Dsus4: { frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] },
  Esus4: { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0] },
};

/** OPEN_SHAPES 키에 붙는 꼬리표. 이 표에 없는 성질은 오픈 폼이 없다. */
const OPEN_SUFFIX: Record<string, string> = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  min7: "m7",
  sus4: "sus4",
};

/**
 * 바레 폼. 상대 프렛(0 = 바레 위치)과 손가락.
 * E폼은 근음이 6번줄, A폼은 5번줄. -9는 뮤트.
 *
 * 각 폼은 표준 오픈 코드를 한 프렛씩 밀어 만든 것이다.
 * 예: E폼 min7 = Em7(020000)을 바레로 옮긴 [0,2,0,0,0,0].
 */
const X = -9;

const E_SHAPES: Record<string, Shape> = {
  maj:     { frets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
  min:     { frets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
  "7":     { frets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
  min7:    { frets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
  maj7:    { frets: [0, 2, 1, 1, 0, 0], fingers: [1, 3, 2, 2, 1, 1] },
  sus4:    { frets: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1] },
  minmaj7: { frets: [0, 2, 1, 0, 0, 0], fingers: [1, 3, 2, 1, 1, 1] },
};

const A_SHAPES: Record<string, Shape> = {
  maj:    { frets: [X, 0, 2, 2, 2, 0], fingers: [0, 1, 2, 3, 4, 1] },
  min:    { frets: [X, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1] },
  "7":    { frets: [X, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1] },
  min7:   { frets: [X, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1] },
  maj7:   { frets: [X, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1] },
  sus2:   { frets: [X, 0, 2, 2, 0, 0], fingers: [0, 1, 3, 4, 1, 1] },
  sus4:   { frets: [X, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1] },
  "6":    { frets: [X, 0, 2, 2, 2, 2], fingers: [0, 1, 3, 3, 3, 3] },
  min6:   { frets: [X, 0, 2, 2, 1, 2], fingers: [0, 1, 3, 4, 2, 4] },
  // 아래 셋은 바레 없이 짚는 블록 코드라 상대 프렛만 옮긴다
  min7b5: { frets: [X, 0, 1, 0, 1, X], fingers: [0, 1, 2, 1, 3, 0] },
  dim:    { frets: [X, 0, 1, 2, 1, X], fingers: [0, 1, 2, 4, 3, 0] },
  dim7:   { frets: [X, 0, 1, 0, 1, X], fingers: [0, 1, 2, 1, 3, 0] },
  aug:    { frets: [X, 0, 3, 2, 2, X], fingers: [0, 1, 4, 2, 3, 0] },
};

// 개방현 음정: 6번줄 E(4), 5번줄 A(9)
const LOW_E_PC = 4;
const A_PC = 9;

/** 바레가 실제로 필요한 폼인지(상대 0프렛을 여러 줄이 쓰는지) */
function needsBarre(shape: Shape): boolean {
  return shape.frets.filter((f) => f === 0).length >= 2;
}

function fromShape(shape: Shape, fret: number, shapeKind: "E" | "A"): Voicing {
  const frets = shape.frets.map((f) => (f === X ? -1 : f + fret));
  const barre = needsBarre(shape)
    ? { fret, fromString: shapeKind === "E" ? 0 : 1, toString: 5 }
    : undefined;
  return {
    frets,
    fingers: shape.fingers,
    barre,
    baseFret: fret <= 3 ? 1 : fret,
  };
}

/** 코드(근음 + 스키마 quality)의 운지. 폼이 없으면 null. */
export function voicingFor(root: string | null, quality: string): Voicing | null {
  if (!root || quality === "N") return null;

  // 1포지션 오픈 폼이 있으면 그것부터 — 수업이 가르치는 모양이다
  const suffix = OPEN_SUFFIX[quality];
  if (suffix !== undefined) {
    const open = OPEN_SHAPES[root + suffix];
    if (open) return { frets: open.frets, fingers: open.fingers, baseFret: 1 };
  }

  const pc = PITCH_CLASS[root];
  if (pc === undefined) return null;

  // 0프렛이 나오면 오픈 포지션이라는 뜻. 바레폼은 12프렛으로 밀어 잡는다.
  const eFret = (pc - LOW_E_PC + 12) % 12 || 12;
  const aFret = (pc - A_PC + 12) % 12 || 12;

  const eShape = E_SHAPES[quality];
  const aShape = A_SHAPES[quality];

  // 두 폼 다 있으면 더 낮은 포지션을 쓴다
  if (eShape && aShape) {
    return eFret <= aFret
      ? fromShape(eShape, eFret, "E")
      : fromShape(aShape, aFret, "A");
  }
  if (eShape) return fromShape(eShape, eFret, "E");
  if (aShape) return fromShape(aShape, aFret, "A");
  return null;
}
