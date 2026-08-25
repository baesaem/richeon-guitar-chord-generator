"use client";

import type { Voicing } from "@/lib/voicings";

const STRINGS = 6;
const FRETS = 5;

interface Props {
  voicing: Voicing | null;
  label: string;
  /** 폰에서 한 손으로 들고 볼 크기를 기본으로 잡는다 */
  width?: number;
}

/**
 * 코드 다이어그램.
 *
 * 세로선 6개가 줄이고 왼쪽이 6번줄(낮은 E) — 기타를 세워 마주 본 방향.
 * 프렛 표기는 baseFret부터 5칸.
 */
export function ChordDiagram({ voicing, label, width = 132 }: Props) {
  const padX = 14;
  const padTop = 28;
  const padBottom = 8;
  const boardW = width - padX * 2;
  const stringGap = boardW / (STRINGS - 1);
  const fretGap = stringGap * 1.15;
  const boardH = fretGap * FRETS;
  const height = padTop + boardH + padBottom;

  if (!voicing) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400"
        style={{ width, height }}
      >
        운지 없음
      </div>
    );
  }

  const { frets, barre, baseFret } = voicing;
  const showNut = baseFret === 1;
  const x = (stringIndex: number) => padX + stringIndex * stringGap;
  const y = (fretOffset: number) => padTop + fretOffset * fretGap;
  // baseFret 프렛은 첫 칸의 한가운데에 찍는다
  const dotY = (fret: number) => y(fret - baseFret + 0.5);

  return (
    <svg width={width} height={height} role="img" aria-label={`${label} 운지`}>
      {/* 줄 */}
      {Array.from({ length: STRINGS }, (_, i) => (
        <line
          key={`s${i}`}
          x1={x(i)} y1={y(0)} x2={x(i)} y2={y(FRETS)}
          stroke="currentColor" strokeWidth={1} opacity={0.55}
        />
      ))}
      {/* 프렛 */}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line
          key={`f${i}`}
          x1={x(0)} y1={y(i)} x2={x(STRINGS - 1)} y2={y(i)}
          stroke="currentColor" strokeWidth={1} opacity={0.4}
        />
      ))}
      {/* 너트. 선 대신 지판 '위쪽'에만 붙는 사각형으로 그린다.
          선으로 그리면 1프렛 바레와 겹쳐 붙어 버려 구분이 안 된다. */}
      {showNut && (
        <rect
          x={x(0)} y={y(0) - 3.5}
          width={x(STRINGS - 1) - x(0)} height={3.5}
          fill="currentColor" opacity={0.9}
        />
      )}

      {/* 개방현 ○ / 뮤트 × */}
      {frets.map((f, i) =>
        f === 0 ? (
          <circle key={`o${i}`} cx={x(i)} cy={padTop - 9} r={3.6}
            fill="none" stroke="currentColor" strokeWidth={1.4} />
        ) : f < 0 ? (
          <g key={`m${i}`} stroke="currentColor" strokeWidth={1.4}>
            <line x1={x(i) - 3.4} y1={padTop - 12.4} x2={x(i) + 3.4} y2={padTop - 5.6} />
            <line x1={x(i) - 3.4} y1={padTop - 5.6} x2={x(i) + 3.4} y2={padTop - 12.4} />
          </g>
        ) : null,
      )}

      {/* 바레 */}
      {barre && (
        <rect
          x={x(barre.fromString) - 5.5}
          y={dotY(barre.fret) - 5.5}
          width={x(barre.toString) - x(barre.fromString) + 11}
          height={10}
          rx={5}
          fill="currentColor"
        />
      )}

      {/* 눌린 음 */}
      {frets.map((f, i) =>
        f > 0 && !(barre && f === barre.fret) ? (
          <circle key={`d${i}`} cx={x(i)} cy={dotY(f)} r={5.5} fill="currentColor" />
        ) : null,
      )}

      {/* 시작 프렛 번호 */}
      {!showNut && (
        <text
          x={x(0) - 7} y={dotY(baseFret) + 4}
          textAnchor="end" fontSize={11} fill="currentColor" opacity={0.7}
        >
          {baseFret}
        </text>
      )}
    </svg>
  );
}
