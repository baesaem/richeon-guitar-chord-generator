/**
 * 기타 운지 생성 (CAGED 기반).
 *
 * 코드 사전을 통째로 들고 오는 대신, 오픈 코드 8개를 표로 두고
 * 나머지는 E폼·A폼 바레를 해당 프렛으로 옮겨서 만든다.
 * 지금 백엔드가 내는 어휘가 장·단3화음 24개뿐이라 이걸로 전부 덮인다.
 * (M4에서 7th·sus가 나오기 시작하면 폼을 추가해야 한다)
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
};

// 개방현 음정: 6번줄 E(4) … 5번줄 A(9)
const LOW_E_PC = 4;
const A_PC = 9;

function barreVoicing(
  fret: number,
  minor: boolean,
  shape: "E" | "A",
): Voicing {
  const frets =
    shape === "E"
      ? minor
        ? [fret, fret + 2, fret + 2, fret, fret, fret]
        : [fret, fret + 2, fret + 2, fret + 1, fret, fret]
      : minor
        ? [-1, fret, fret + 2, fret + 2, fret + 1, fret]
        : [-1, fret, fret + 2, fret + 2, fret + 2, fret];

  // 바레는 언제나 검지(1). 나머지는 폼별 표준 운지.
  const fingers =
    shape === "E"
      ? minor
        ? [1, 3, 4, 1, 1, 1]
        : [1, 3, 4, 2, 1, 1]
      : minor
        ? [0, 1, 3, 4, 2, 1]
        : [0, 1, 2, 3, 4, 1];

  return {
    frets,
    fingers,
    barre: { fret, fromString: shape === "E" ? 0 : 1, toString: 5 },
    baseFret: fret <= 3 ? 1 : fret,
  };
}

/** 코드 라벨("Ab", "Bbm", "F#m", "N.C.")에 대한 운지. 못 만들면 null. */
export function voicingFor(root: string | null, quality: string): Voicing | null {
  if (!root || quality === "N") return null;

  const minor = quality === "min";
  const key = minor ? `${root}m` : root;
  const open = OPEN_SHAPES[key];
  if (open) {
    return { frets: open.frets, fingers: open.fingers, baseFret: 1 };
  }

  const pc = PITCH_CLASS[root];
  if (pc === undefined) return null;

  // 6번줄 루트(E폼)와 5번줄 루트(A폼) 중 더 낮은 포지션을 쓴다.
  // 0프렛이 나오면 오픈 코드라는 뜻인데 위 표에서 이미 처리됐으므로 12로 밀어둔다.
  const eFret = (pc - LOW_E_PC + 12) % 12 || 12;
  const aFret = (pc - A_PC + 12) % 12 || 12;

  return eFret <= aFret
    ? barreVoicing(eFret, minor, "E")
    : barreVoicing(aFret, minor, "A");
}
