"use client";

import { useState } from "react";

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

type PanelKind = "pitch" | "speed" | "loop";

/** 화면 중앙 팝업. 배경을 누르면 닫힌다. */
function Popup({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            className="rounded px-2 py-1 text-sm text-gray-500"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 화면 아래 고정 컨트롤. 음높이(이조·카포)/빠르기/반복은 팝업으로 조정한다. */
export function TransportBar(props: Props) {
  const { duration, time, playing, transpose, rate, loop } = props;
  const [panel, setPanel] = useState<PanelKind | null>(null);

  const close = () => setPanel(null);

  const tabClass =
    "flex-1 rounded-lg bg-gray-100 py-2 text-sm dark:bg-gray-800";

  const pill = (active: boolean) =>
    [
      "rounded px-0 py-2 text-sm",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "bg-gray-100 dark:bg-gray-800",
    ].join(" ");

  // 카포: c프렛에 끼우면 코드 모양이 -c 반음 이조된 것과 같다.
  // 즉 transpose가 음수일 때 그 절댓값이 카포 위치다.
  const capo = transpose < 0 ? -transpose : 0;

  return (
    <div className="sticky bottom-0 border-t border-gray-200 bg-white px-3 pb-3 pt-2 dark:border-gray-800 dark:bg-black">
      <div className="mb-1.5 flex items-center gap-2">
        <button
          className="h-10 w-10 shrink-0 rounded-full bg-black text-white dark:bg-white dark:text-black"
          onClick={props.onToggle}
          aria-label={playing ? "일시정지" : "재생"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
          {clock(time)}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={0}
          max={Math.max(duration, 1)}
          step={0.1}
          value={Math.min(time, duration)}
          onChange={(e) => props.onSeek(Number(e.target.value))}
        />
        <span className="w-10 shrink-0 text-xs tabular-nums text-gray-500">
          {clock(duration)}
        </span>
      </div>

      <div className="flex gap-1.5">
        <button className={tabClass} onClick={() => setPanel("pitch")}>
          음높이
          {transpose !== 0
            ? ` ${transpose > 0 ? "+" : ""}${transpose}${capo ? ` (카포 ${capo})` : ""}`
            : ""}
        </button>
        <button className={tabClass} onClick={() => setPanel("speed")}>
          빠르기{rate !== 1 ? ` ${rate}×` : ""}
        </button>
        <button className={tabClass} onClick={() => setPanel("loop")}>
          반복{loop ? " ●" : ""}
        </button>
      </div>

      {/* ---- 음높이 (이조 + 카포) ---- */}
      {panel === "pitch" && (
        <Popup title="음높이" onClose={close}>
          <p className="mb-2 rounded bg-gray-50 p-2 text-[11px] leading-snug text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            내리기(−)는 카포와 같습니다 — 소리는 원곡 그대로, 코드 모양만
            쉬워집니다. 올리기(+)는 표기만 바뀌므로 영상과 함께 치면 음이
            어긋납니다.
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
                  : transpose < 0
                    ? `카포 ${-transpose}프렛과 같음`
                    : "표기만 올라감 — 재생 소리는 그대로"}
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
                onClick={() => props.onTranspose(-fret)}
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
        </Popup>
      )}

      {/* ---- 빠르기 ---- */}
      {panel === "speed" && (
        <Popup title="빠르기" onClose={close}>
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
        </Popup>
      )}

      {/* ---- 반복 (A-B 구간) ---- */}
      {panel === "loop" && (
        <Popup title="구간 반복" onClose={close}>
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
    </div>
  );
}
