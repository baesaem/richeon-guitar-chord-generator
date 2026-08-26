"use client";

import { useState } from "react";

import { Popup } from "@/components/Popup";

interface Props {
  duration: number;
  time: number;
  playing: boolean;
  transpose: number;
  rate: number;
  loop: { a: number; b: number } | null;
  onSeek: (t: number) => void;
  onToggle: () => void;
  onTranspose: (semitones: number) => void;
  onRate: (rate: number) => void;
  onLoop: (loop: { a: number; b: number } | null) => void;
}

const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = String(Math.floor(t % 60)).padStart(2, "0");
  return `${m}:${s}`;
}

/** 재생 버튼 + 탐색 슬라이더. 파형/악보 바로 아래에 놓는다. */
export function SeekBar({
  duration,
  time,
  playing,
  onSeek,
  onToggle,
}: Pick<Props, "duration" | "time" | "playing" | "onSeek" | "onToggle">) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-1.5 dark:border-gray-800">
      <button
        className="h-9 w-9 shrink-0 rounded-full bg-black text-white dark:bg-white dark:text-black"
        onClick={onToggle}
        aria-label={playing ? "일시정지" : "재생"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
        {clock(time)}
      </span>
      <input
        type="range"
        className="seekbar min-w-0 flex-1"
        min={0}
        max={Math.max(duration, 1)}
        step={0.1}
        value={Math.min(time, duration)}
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="w-10 shrink-0 text-xs tabular-nums text-gray-500">
        {clock(duration)}
      </span>
    </div>
  );
}

/** 음높이(이조·카포)·빠르기·반복을 한 팝업에 모은 「연주설정」 버튼.
 *  파형/코드악보 전환 줄의 영상접기 왼쪽에 놓인다. */
export function PlaySettings(props: Omit<Props, "playing" | "onSeek" | "onToggle">) {
  const { duration, time, transpose, rate, loop } = props;
  const [open, setOpen] = useState(false);

  const pill = (active: boolean) =>
    [
      "rounded px-0 py-2 text-sm",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "bg-gray-100 dark:bg-gray-800",
    ].join(" ");

  const sectionTitle = "mb-1 mt-0 text-xs font-semibold text-[var(--accent)]";

  // 음높이 +n = 카포 n프렛. 카포가 소리를 올려주는 만큼 화면 코드는
  // 내린 모양으로 표기된다(표기 변환은 page.tsx의 noteShift가 담당).
  const capo = transpose > 0 ? transpose : 0;
  // 기본값에서 벗어난 설정이 있으면 버튼에 점을 찍어 알린다
  const tweaked = transpose !== 0 || rate !== 1 || loop !== null;

  return (
    <>
      <button
        className="flex shrink-0 items-center gap-1 rounded-lg bg-gray-200/70 px-2 py-1.5 text-[13px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        onClick={() => setOpen(true)}
        title="음높이·빠르기·반복"
      >
        {/* 슬라이더(조절) 아이콘 */}
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h8M17.5 7H20M4 17h2.5M11 17h9" />
          <circle cx="14.5" cy="7" r="2" />
          <circle cx="8.5" cy="17" r="2" />
        </svg>
        연주설정
        {tweaked && <span className="text-[var(--accent)]">●</span>}
      </button>

      {open && (
        <Popup title="연주설정" onClose={() => setOpen(false)}>
          {/* ---- 음높이 (이조 + 카포) ---- */}
          <div className={sectionTitle}>
            음높이
            {transpose !== 0 &&
              ` · ${transpose > 0 ? "+" : ""}${transpose}${capo ? ` (카포 ${capo})` : ""}`}
          </div>
          <p className="mb-2 rounded bg-gray-50 p-2 text-[11px] leading-snug text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            올리기(+)는 카포 위치입니다 — 카포를 그 프렛에 끼우면 소리는 원곡
            그대로, 코드 모양만 쉬워집니다. 내리기(−)는 표기만 내려가므로
            영상과 함께 치면 음이 어긋납니다.
          </p>
          <div className="mb-1 text-xs font-medium text-gray-500">이조 (반음)</div>
          <div className="mb-3 flex items-center gap-2">
            <button
              className="h-11 w-11 rounded bg-gray-100 text-lg dark:bg-gray-800"
              onClick={() => props.onTranspose(Math.max(transpose - 1, -11))}
            >
              −
            </button>
            <div className="flex-1 text-center">
              <div className="text-2xl font-bold tabular-nums">
                {transpose > 0 ? `+${transpose}` : transpose}
              </div>
              <div className="text-[11px] text-gray-500">
                {transpose === 0
                  ? "원래 조"
                  : transpose > 0
                    ? `카포 ${transpose}프렛`
                    : "표기만 내려감 — 재생 소리는 그대로"}
              </div>
            </div>
            <button
              className="h-11 w-11 rounded bg-gray-100 text-lg dark:bg-gray-800"
              onClick={() => props.onTranspose(Math.min(transpose + 1, 11))}
            >
              +
            </button>
          </div>

          <div className="mb-1 text-xs font-medium text-gray-500">
            카포 위치 — 끼우면 원래 음높이 그대로, 코드 모양만 쉬워집니다
          </div>
          <div className="mb-3 grid grid-cols-6 gap-1">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((fret) => (
              <button
                key={fret}
                className={pill(capo === fret && (fret === 0 ? transpose === 0 : true))}
                onClick={() => props.onTranspose(fret)}
              >
                {fret === 0 ? "없음" : fret}
              </button>
            ))}
          </div>
          {capo > 0 && (
            <p className="mb-2 rounded bg-gray-50 p-2 text-[11px] leading-snug text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              카포 {capo}프렛에 끼우고 화면의 코드를 그대로 잡으면 원곡 음높이로
              소리 납니다.
            </p>
          )}
          <button
            className="w-full rounded bg-gray-100 py-2 text-sm dark:bg-gray-800"
            onClick={() => props.onTranspose(0)}
          >
            초기화
          </button>

          {/* ---- 빠르기 ---- */}
          <div className="my-3 h-px bg-gray-200 dark:bg-gray-700" />
          <div className={sectionTitle}>빠르기{rate !== 1 && ` · ${rate}×`}</div>
          <div className="grid grid-cols-5 gap-1.5">
            {RATES.map((r) => (
              <button
                key={r}
                className={pill(r === rate)}
                onClick={() => props.onRate(r)}
              >
                {r}×
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            음높이는 그대로 두고 속도만 바뀝니다. 연습은 0.7×부터 올리는 것을
            권합니다.
          </p>

          {/* ---- 반복 (A-B 구간) ---- */}
          <div className="my-3 h-px bg-gray-200 dark:bg-gray-700" />
          <div className={sectionTitle}>구간 반복{loop && " · 사용 중"}</div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <div className="text-[11px] text-gray-500">시작 (A)</div>
              <div className="text-xl font-bold tabular-nums">
                {loop ? clock(loop.a) : "—"}
              </div>
            </div>
            <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <div className="text-[11px] text-gray-500">끝 (B)</div>
              <div className="text-xl font-bold tabular-nums">
                {loop ? clock(loop.b) : "—"}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              className="flex-1 rounded bg-gray-100 py-2.5 text-sm dark:bg-gray-800"
              onClick={() =>
                props.onLoop({ a: time, b: Math.max(loop?.b ?? duration, time + 1) })
              }
            >
              지금을 시작으로
            </button>
            <button
              className="flex-1 rounded bg-gray-100 py-2.5 text-sm dark:bg-gray-800"
              onClick={() => props.onLoop({ a: Math.min(loop?.a ?? 0, time), b: time })}
            >
              지금을 끝으로
            </button>
          </div>
          <button
            className="mt-2 w-full rounded bg-gray-100 py-2 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            onClick={() => props.onLoop(null)}
          >
            반복 해제
          </button>
          <p className="mt-2 text-[11px] text-gray-500">
            재생하다가 구간의 시작과 끝에서 각각 누르면 그 사이를 반복합니다.
          </p>
        </Popup>
      )}
    </>
  );
}
