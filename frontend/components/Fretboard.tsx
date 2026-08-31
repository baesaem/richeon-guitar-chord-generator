"use client";

/**
 * 기타 지판표 — 어느 자리가 무슨 음인지.
 *
 * 코드 모양만 외우면 아는 코드 밖으로 못 나간다. 지판에서 음 자리를
 * 알면 카포를 옮기거나 다른 자리에서 같은 코드를 잡을 수 있다.
 *
 * 온음(A~G)만 적는다. 반음까지 넣으면 칸마다 글자가 두 개씩 들어가
 * 폰 화면에서 읽을 수 없다. 반음은 온음 사이 한 칸이라는 것만 알면 된다.
 */

/** 위에서 아래로: 1번줄(가는 E) → 6번줄(굵은 E). 악보와 같은 순서다. */
const STRINGS = ["E", "B", "G", "D", "A", "E"];
const OPEN_PC = [4, 11, 7, 2, 9, 4];

const NAMES: Record<number, string> = {
  0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B",
};

const FRETS = 15;
/** 손가락 위치를 짚어 주는 표식 프렛. 실제 기타 지판의 점과 같다 */
const MARKERS = [3, 5, 7, 9, 12, 15];

const CELL_W = 34;
const ROW_H = 22;
const LABEL_W = 22;
const TOP = 4;

export function Fretboard() {
  const width = LABEL_W + (FRETS + 1) * CELL_W;
  const height = TOP + STRINGS.length * ROW_H + 16;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width, maxWidth: "none" }}
        className="h-auto text-[var(--foreground)]"
        role="img"
        aria-label="기타 지판 음 이름표"
      >
        {/* 프렛 표식 — 3·5·7·9·12·15 */}
        {MARKERS.map((f) => (
          <rect
            key={`m${f}`}
            x={LABEL_W + f * CELL_W}
            y={TOP}
            width={CELL_W}
            height={STRINGS.length * ROW_H}
            fill="currentColor"
            opacity={0.06}
          />
        ))}

        {/* 줄 */}
        {STRINGS.map((name, i) => (
          <g key={`s${i}`}>
            <line
              x1={LABEL_W}
              x2={width}
              y1={TOP + i * ROW_H + ROW_H / 2}
              y2={TOP + i * ROW_H + ROW_H / 2}
              stroke="currentColor"
              strokeWidth={0.6}
              opacity={0.35}
            />
            <text
              x={LABEL_W - 6}
              y={TOP + i * ROW_H + ROW_H / 2 + 3.5}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              opacity={0.6}
            >
              {name}
            </text>
          </g>
        ))}

        {/* 프렛 선. 0프렛(너트)은 굵게 */}
        {Array.from({ length: FRETS + 1 }, (_, f) => (
          <line
            key={`f${f}`}
            x1={LABEL_W + f * CELL_W}
            x2={LABEL_W + f * CELL_W}
            y1={TOP}
            y2={TOP + STRINGS.length * ROW_H}
            stroke="currentColor"
            strokeWidth={f === 0 ? 2 : 0.6}
            opacity={f === 0 ? 0.7 : 0.25}
          />
        ))}

        {/* 음 이름 */}
        {STRINGS.map((_, s) =>
          Array.from({ length: FRETS + 1 }, (_, f) => {
            const name = NAMES[(OPEN_PC[s] + f) % 12];
            if (!name) return null;
            const cx = LABEL_W + f * CELL_W + CELL_W / 2;
            const cy = TOP + s * ROW_H + ROW_H / 2;
            return (
              <g key={`n${s}-${f}`}>
                <circle cx={cx} cy={cy} r={7.5} fill="currentColor" />
                <text
                  x={cx}
                  y={cy + 3.2}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  className="fill-white dark:fill-black"
                >
                  {name}
                </text>
              </g>
            );
          }),
        )}

        {/* 프렛 번호 */}
        {MARKERS.map((f) => (
          <text
            key={`l${f}`}
            x={LABEL_W + f * CELL_W + CELL_W / 2}
            y={TOP + STRINGS.length * ROW_H + 11}
            textAnchor="middle"
            fontSize={8}
            fill="currentColor"
            opacity={0.5}
          >
            {f}fr
          </text>
        ))}
        <text
          x={LABEL_W + CELL_W / 2}
          y={TOP + STRINGS.length * ROW_H + 11}
          textAnchor="middle"
          fontSize={8}
          fill="currentColor"
          opacity={0.5}
        >
          개방현
        </text>
      </svg>
    </div>
  );
}
