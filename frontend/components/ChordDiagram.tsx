"use client";

import type { Voicing } from "@/lib/voicings";

const STRINGS = 6;
const FRETS = 5;

/** 이보다 점이 작아지면 손가락 번호가 읽히지 않으므로 숫자를 생략한다 */
const FINGER_TEXT_MIN_RADIUS = 5;

interface Props {
  voicing: Voicing | null;
  label: string;
  /** 폰에서 한 손으로 들고 볼 크기를 기본으로 잡는다 */
  width?: number;
  /** 점 안에 손가락 번호를 표시할지 */
  showFingers?: boolean;
}

/**
 * 코드 다이어그램.
 *
 * 세로선 6개가 줄이고 왼쪽이 6번줄(낮은 E) — 기타를 세워 마주 본 방향.
 * 프렛 표기는 baseFret부터 5칸.
 *
 * 크기는 전부 width에서 비율로 계산한다. 고정 픽셀을 쓰면 작은 크기에서
 * 점이 프렛 간격보다 커져 서로 뭉개진다.
 */
export function ChordDiagram({ voicing, label, width = 132, showFingers = true }: Props) {
  // 왼쪽은 시작 프렛 번호가 들어갈 자리라 더 넓게 잡는다
  const padLeft = width * 0.17;
  const padRight = width * 0.07;
  const boardW = width - padLeft - padRight;
  const stringGap = boardW / (STRINGS - 1);
  const fretGap = stringGap * 1.15;
  const dotR = stringGap * 0.34;
  const padTop = stringGap * 1.7;   // ×/○ 표시가 들어갈 공간
  const padBottom = stringGap * 0.4;
  const height = padTop + fretGap * FRETS + padBottom;

  if (!voicing) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-[var(--panel-line)] text-[10px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]"
        style={{ width, height }}
      >
        운지 없음
      </div>
    );
  }

  const { frets, fingers, barre, baseFret } = voicing;
  const showNut = baseFret === 1;
  const numbersOn = showFingers && dotR >= FINGER_TEXT_MIN_RADIUS;
  const markR = dotR * 0.75;

  const x = (stringIndex: number) => padLeft + stringIndex * stringGap;
  const y = (fretOffset: number) => padTop + fretOffset * fretGap;
  // baseFret 프렛은 첫 칸의 한가운데에 찍는다
  const dotY = (fret: number) => y(fret - baseFret + 0.5);
  const markY = padTop - markR * 1.6;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label} 운지`}
    >
      {/* 줄 */}
      {Array.from({ length: STRINGS }, (_, i) => (
        <line
          key={`s${i}`}
          x1={x(i)} y1={y(0)} x2={x(i)} y2={y(FRETS)}
          stroke="currentColor" strokeWidth={0.8} opacity={0.55}
        />
      ))}
      {/* 프렛 */}
      {Array.from({ length: FRETS + 1 }, (_, i) => (
        <line
          key={`f${i}`}
          x1={x(0)} y1={y(i)} x2={x(STRINGS - 1)} y2={y(i)}
          stroke="currentColor" strokeWidth={0.8} opacity={0.4}
        />
      ))}
      {/* 너트. 선 대신 지판 '위쪽'에만 붙는 사각형으로 그린다.
          선으로 그리면 1프렛 바레와 겹쳐 붙어 버려 구분이 안 된다. */}
      {showNut && (
        <rect
          x={x(0)} y={y(0) - dotR * 0.6}
          width={x(STRINGS - 1) - x(0)} height={dotR * 0.6}
          fill="currentColor" opacity={0.9}
        />
      )}

      {/* 개방현 ○ / 뮤트 × */}
      {frets.map((f, i) =>
        f === 0 ? (
          <circle
            key={`o${i}`} cx={x(i)} cy={markY} r={markR}
            fill="none" stroke="currentColor" strokeWidth={dotR * 0.28}
          />
        ) : f < 0 ? (
          <g key={`m${i}`} stroke="currentColor" strokeWidth={dotR * 0.28}>
            <line x1={x(i) - markR} y1={markY - markR} x2={x(i) + markR} y2={markY + markR} />
            <line x1={x(i) - markR} y1={markY + markR} x2={x(i) + markR} y2={markY - markR} />
          </g>
        ) : null,
      )}

      {/* 바레 */}
      {barre && (
        <>
          <rect
            x={x(barre.fromString) - dotR}
            y={dotY(barre.fret) - dotR}
            width={x(barre.toString) - x(barre.fromString) + dotR * 2}
            height={dotR * 2}
            rx={dotR}
            fill="currentColor"
          />
          {numbersOn && (
            <text
              x={x(barre.fromString)} y={dotY(barre.fret)}
              textAnchor="middle" dominantBaseline="central"
              fontSize={dotR * 1.4} fontWeight="700"
              className="fill-white dark:fill-black"
            >
              1
            </text>
          )}
        </>
      )}

      {/* 눌린 음 */}
      {frets.map((f, i) =>
        f > 0 && !(barre && f === barre.fret) ? (
          <g key={`d${i}`}>
            <circle cx={x(i)} cy={dotY(f)} r={dotR} fill="currentColor" />
            {numbersOn && fingers[i] > 0 && (
              <text
                x={x(i)} y={dotY(f)}
                textAnchor="middle" dominantBaseline="central"
                fontSize={dotR * 1.4} fontWeight="700"
                className="fill-white dark:fill-black"
              >
                {fingers[i]}
              </text>
            )}
          </g>
        ) : null,
      )}

      {/* 시작 프렛 번호 */}
      {!showNut && (
        <text
          x={x(0) - dotR * 0.8} y={dotY(baseFret)}
          textAnchor="end" dominantBaseline="central"
          fontSize={dotR * 1.7} fill="currentColor" opacity={0.7}
        >
          {baseFret}
        </text>
      )}
    </svg>
  );
}
