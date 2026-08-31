"use client";

/**
 * 연습실 — AI 악보앱(리천 기타연습실)과 같은 화면 짜임.
 *
 * 위에서부터: 영상 / 설정 한 줄(음원·싱크·음높이·빠르기·연주설정) /
 * 트랜스포트(⏮ ▶ ⏭ + 탐색) / 악보. **악보 칸만 스크롤**하고 나머지는
 * 늘 제자리에 있다 — 연주하다 화면을 만질 일이 없도록.
 *
 * 이 파일은 짜임새만 안다. 영상(PlayerPane)·악보(AbcScore)·연주설정
 * (PlaySettings)은 부모가 만들어 슬롯으로 꽂는다 — 그쪽 부품들의 많은
 * 상태를 여기로 끌고 오지 않기 위해서다.
 */

import type { Playback } from "@/components/PlayerPane";
import type { StemChoice } from "@/lib/sharedFiles";
import { useEffect, useRef, useState } from "react";

import { Popup } from "@/components/Popup";

import { useSmoothTime } from "@/lib/useSmoothTime";

/** AI 앱과 같은 단계 목록 */
const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

/**
 * 누르고 있는 동안 계속 부른다.
 *
 * 싱크를 1초 옮기려면 열 번을 눌러야 했다. 0.4초쯤 누르고 있으면
 * 저절로 이어지고, 오래 누를수록 빨라진다 — 손을 떼면 멈춘다.
 */
function useHold(fn: () => void) {
  /* 되풀이할 때마다 「그때의」 함수를 쓴다.
     처음 넘어온 함수를 붙들고 있으면 늘 같은 값에서 한 칸을 더해,
     아무리 눌러도 숫자가 한 번만 바뀐다. */
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = () => fnRef.current();
  const timers = useRef<{ start?: number; tick?: number }>({});
  const stop = () => {
    window.clearTimeout(timers.current.start);
    window.clearInterval(timers.current.tick);
    timers.current = {};
  };
  useEffect(() => stop, []);
  const start = () => {
    run();
    stop();
    timers.current.start = window.setTimeout(() => {
      let n = 0;
      timers.current.tick = window.setInterval(() => {
        run();
        // 스무 번쯤 지나면 한 번 더 빠르게 — 멀리 옮길 때 지치지 않게
        if (++n === 20) {
          window.clearInterval(timers.current.tick);
          timers.current.tick = window.setInterval(run, 45);
        }
      }, 110);
    }, 400);
  };
  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}

/** AI 앱의 스텝퍼(－ 값 ＋). 값을 누르면 초기화, 길게 누르면 이어서 바뀐다 */
function Step({
  label,
  value,
  onMinus,
  onPlus,
  onReset,
  width = "w-9",
  minusTitle,
  plusTitle,
  show = "flex",
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  onReset?: () => void;
  width?: string;
  minusTitle?: string;
  plusTitle?: string;
  /** 어느 화면에서 보일지. 폰에서 감출 것은 "hidden big:flex" */
  show?: string;
}) {
  const btn =
    "select-none touch-none rounded bg-gray-200/70 px-1 font-bold leading-5 text-gray-900 dark:bg-gray-700 dark:text-gray-100";
  const minusHold = useHold(onMinus);
  const plusHold = useHold(onPlus);
  return (
    <span className={`${show} shrink-0 items-center gap-0.5 text-[11px]`}>
      <span className="text-gray-400">{label}</span>
      <button className={btn} {...minusHold} title={minusTitle}>
        －
      </button>
      <button
        className={`${width} text-center tabular-nums ${onReset ? "cursor-pointer" : ""}`}
        onClick={onReset}
        title={onReset ? "누르면 초기화" : undefined}
      >
        {value}
      </button>
      <button className={btn} {...plusHold} title={plusTitle}>
        ＋
      </button>
    </span>
  );
}

interface Props {
  title: string;
  /** 영상 칸(PlayerPane). 업로드 곡이면 오디오 태그가 온다 */
  video: React.ReactNode;
  /** 악보 칸(AbcScore 또는 MelodyScore) */
  score: React.ReactNode;
  /** 구간반복·주법 등 나머지를 담은 「연주설정」 버튼(PlaySettings) */
  playSettings: React.ReactNode;
  /** 가사 칸(LyricsPane). 넓은 화면에서 영상 아래에 늘 펼친다 */
  lyrics?: React.ReactNode;

  playback: Playback | null;
  time: number;
  duration: number;
  onSeek: (t: number) => void;

  /** 음원: off=원곡(영상 소리), vocals=보컬만, inst=반주만 */
  stem: StemChoice;
  onStem?: (next: StemChoice) => void;
  /** 반주 트랙을 만드는 중 — 버튼을 잠근다 */
  vocalBusy?: boolean;

  sync: number;
  onSync: (sec: number) => void;
  /**
   * 악보를 음원 위에서 한 마디씩 미는 손잡이(강사님).
   *
   * 싱크 옆에 있어야 한다 — 어긋난 것이 한 마디인지 반 박인지는
   * 눌러 보며 가리는 일이라, 두 손잡이가 떨어져 있으면 오가야 한다.
   */
  barOffset?: number;
  onBarOffset?: (v: number) => void;
  /**
   * 영상을 감춰 악보에 자리를 넘긴다.
   *
   * 감춰도 영상은 화면에 남겨 둔다 — 떼어내면 소리가 끊긴다.
   */
  videoCompact?: boolean;
  onVideoCompact?: (v: boolean) => void;
  /** 악보 칸에 무엇을 볼지 고르는 단추들([악보][타브][파형][그리드]) */
  viewTabs?: React.ReactNode;
  /** 음높이(카포). 표기와 소리가 함께 움직인다 */
  pitch: number;
  onPitch: (semitones: number) => void;
  rate: number;
  onRate: (rate: number) => void;
  /** 반복 중이면 ⏮가 A 지점으로 간다 */
  loopA: number | null;

  onBack: () => void;
  /** 목록의 앞·뒤 곡으로. 끝이면 넘기지 않는다(undefined → 잠금) */
  onPrevSong?: () => void;
  onNextSong?: () => void;
  /** 등록된 음원 목록. 「다른 음원」 창이 이것을 보여 준다 */
  songs?: { id: string; title: string }[];
  /** 지금 치고 있는 곡 */
  songId?: string;
  /** 목록에서 고른 곡을 연다 */
  onPickSong?: (id: string) => void;
}

export function PracticeRoom({
  title,
  video,
  score,
  playSettings,
  lyrics,
  playback,
  time,
  duration,
  onSeek,
  stem,
  onStem,
  vocalBusy,
  sync,
  onSync,
  barOffset,
  onBarOffset,
  videoCompact,
  onVideoCompact,
  viewTabs,
  pitch,
  onPitch,
  rate,
  onRate,
  loopA,
  onBack,
  onPrevSong,
  onNextSong,
  songs,
  songId,
  onPickSong,
}: Props) {
  /** 「다른 음원」 창이 열려 있는가 */
  const [picking, setPicking] = useState(false);
  const now = useSmoothTime(time, playback ? playback.getTime : undefined);
  const playing = playback?.isPlaying() ?? false;

  const rateIdx = () => {
    const i = RATES.indexOf(rate);
    return i === -1 ? RATES.indexOf(1) : i;
  };

  const srcBtn = (value: StemChoice, label: string, titleText: string) => (
    <button
      key={value}
      disabled={vocalBusy || !onStem}
      title={titleText}
      onClick={() => onStem?.(value)}
      className={[
        "rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40",
        stem === value
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "bg-gray-200/70 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
      ].join(" ")}
    >
      {label}
    </button>
  );

  const circle =
    "flex shrink-0 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black";

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-2">
      {picking && songs && onPickSong && (
        <Popup title="다른 음원" onClose={() => setPicking(false)}>
          <ul className="space-y-1">
            {songs.map((s) => (
              <li key={s.id}>
                <button
                  className={[
                    "w-full truncate rounded px-3 py-2.5 text-left text-sm",
                    s.id === songId
                      ? "bg-[var(--accent)] font-semibold text-white"
                      : "bg-gray-100 dark:bg-gray-800",
                  ].join(" ")}
                  onClick={() => {
                    setPicking(false);
                    if (s.id !== songId) onPickSong(s.id);
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </Popup>
      )}
      {/* 곡 이름 줄 — 목록으로 돌아가기, 곡 옮기기, 연주설정 */}
      <div className="flex shrink-0 items-center gap-2 px-1">
        <button
          className="shrink-0 rounded bg-gray-200/70 px-2 py-1 text-[11px] font-semibold dark:bg-gray-700"
          onClick={onBack}
        >
          ← 홈
        </button>
        {/* 이전·다음 곡 — 목록 순서대로 옮겨 다닌다 */}
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200/70 text-[10px] text-gray-700 disabled:opacity-30 dark:bg-gray-700 dark:text-gray-200"
          disabled={!onPrevSong}
          title="이전 곡"
          onClick={onPrevSong}
        >
          ◀
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-medium">
          {title}
        </span>
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200/70 text-[10px] text-gray-700 disabled:opacity-30 dark:bg-gray-700 dark:text-gray-200"
          disabled={!onNextSong}
          title="다음 곡"
          onClick={onNextSong}
        >
          ▶
        </button>
        {/* 다른 음원 — ◀ ▶로 한 곡씩 옮기는 것과 달리, 목록에서
            곧바로 집어 간다. 곡이 스무 개면 열아홉 번 누를 수는 없다 */}
        {songs && songs.length > 1 && onPickSong && (
          <button
            className="shrink-0 rounded bg-gray-200/70 px-2 py-1 text-[11px] font-semibold dark:bg-gray-700"
            title="등록된 음원 가운데서 고릅니다"
            onClick={() => setPicking(true)}
          >
            다른 음원
          </button>
        )}
        {/* 연주설정 — 설정줄이 아니라 이 자리다. 곡 이름 옆이라
            어느 화면을 보든 같은 자리에서 열린다 */}
        {playSettings}
      </div>

      {/* 좁은 화면: 영상→설정→악보를 세로로.
          넓은 화면: 예전 홈 재생 화면처럼 두 기둥 — 왼쪽은 악보(눈이 오래
          머무는 쪽이 넓다), 오른쪽은 영상과 그 아래 가사. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:flex-row">
        {/* 오른쪽 기둥 — 영상 + 가사 (폰에서는 맨 위 영상만) */}
        <div className="flex shrink-0 flex-col gap-1.5 md:order-2 md:min-h-0 md:w-[44%] roomy:w-[48%]">
          {/* 폰: 폭 640px·화면높이 68% 중 작은 쪽으로 제한해 악보 자리를
            남긴다. 넓은 화면: 기둥 폭이 곧 제한이라 가득 채운다 */}
          {/* 감춰도 화면에서 떼어내지는 않는다 — 떼면 소리가 끊긴다.
            높이만 0으로 줄여 악보에 자리를 넘긴다 */}
          <section
            className={[
              "mx-auto w-full max-w-[min(640px,68vh)] shrink-0 overflow-hidden md:max-w-none",
              videoCompact
                ? "h-0 border-0"
                : "rounded-xl border border-gray-200 dark:border-gray-700",
            ].join(" ")}
          >
            {video}
          </section>
          {lyrics && (
            <section className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 md:flex dark:border-gray-700">
              {lyrics}
            </section>
          )}
        </div>

        {/* 왼쪽 기둥 — 설정과 악보 */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:order-1 md:min-w-0">
          {/* 설정 상자 — AI 앱과 같은 배치 */}
          <section className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {/* 무엇을 볼지가 먼저다 — 화면을 고른 다음 소리를 고른다 */}
              {viewTabs}
              {/* 이름표 없이 단추만 — 「원곡·보컬·반주」가 곧 무엇인지 말한다 */}
              <span className="flex shrink-0 items-center gap-1 text-[11px]">
                {srcBtn("off", "원곡", "영상의 원래 소리")}
                {srcBtn("vocals", "보컬", "노래만 — 반주를 지운 트랙")}
                {srcBtn(
                  "inst",
                  "반주",
                  "반주만 — 노래를 지운 트랙. 직접 부르거나 칠 때",
                )}
              </span>
              {/* 영상을 감춰 악보에 자리를 넘긴다. 음원 단추 옆이다 —
              무엇을 듣고 무엇을 볼지가 한 묶음이다 */}
              {onVideoCompact && (
                <button
                  onClick={() => onVideoCompact(!videoCompact)}
                  title={
                    videoCompact
                      ? "영상을 다시 보입니다"
                      : "영상을 감춰 악보를 넓게 봅니다"
                  }
                  className="shrink-0 rounded bg-gray-200/70 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                >
                  {videoCompact ? "영상 보기" : "영상 감추기"}
                </button>
              )}
              {/* 싱크·마디·음높이·빠르기는 한 줄에 나란히 둔다.
              따로 흘려 두면 좁은 화면에서 빠르기만 아래로 떨어져,
              같은 성격의 손잡이가 두 줄로 갈린다. 자리가 정 모자라면
              이 덩이 안에서만 옆으로 밀린다. */}
              <span className="flex min-w-0 shrink items-center gap-x-2 overflow-x-auto">
                <Step
                  /* 폰에서는 감춘다 — 같은 것이 연주설정 창에 있고,
                     좁은 화면에서는 손잡이 줄이 악보 자리를 먹는다 */
                  show="hidden big:flex"
                  label="싱크"
                  value={`${sync > 0 ? "+" : ""}${sync.toFixed(1)}`}
                  onMinus={() => onSync(Math.round((sync - 0.1) * 10) / 10)}
                  onPlus={() => onSync(Math.round((sync + 0.1) * 10) / 10)}
                  onReset={() => onSync(0)}
                  minusTitle="화면을 늦춥니다 — 커서가 소리보다 이를 때"
                  plusTitle="화면을 당깁니다 — 커서가 소리보다 늦을 때"
                />
                {/* 값도 단추도 「커서」를 기준으로 읽는다 — ＋를 누르면 커서가
              뒤로 간다. 속으로 세는 마디밀기(barOffset)는 그 반대이므로
              부호를 뒤집어 보여 준다. */}
                {onBarOffset && (
                  <Step
                    label="마디"
                    value={
                      -(barOffset ?? 0) > 0
                        ? `+${-(barOffset ?? 0)}`
                        : String(-(barOffset ?? 0))
                    }
                    onMinus={() => onBarOffset((barOffset ?? 0) + 1)}
                    onPlus={() => onBarOffset((barOffset ?? 0) - 1)}
                    onReset={() => onBarOffset(0)}
                    width="w-7"
                    minusTitle="커서를 한 마디 왼쪽으로 — 커서가 노래보다 이르게 갈 때"
                    plusTitle="커서를 한 마디 오른쪽으로 — 커서가 노래보다 늦게 갈 때"
                  />
                )}
                <Step
                  show="hidden big:flex"
                  label="음높이"
                  value={pitch > 0 ? `+${pitch}` : String(pitch)}
                  onMinus={() => onPitch(Math.max(pitch - 1, -11))}
                  onPlus={() => onPitch(Math.min(pitch + 1, 11))}
                  onReset={() => onPitch(0)}
                  width="w-7"
                  minusTitle="반음 내림 — 악보 표기와 코드가 함께"
                  plusTitle="반음 올림 (카포 자리)"
                />
                <Step
                  show="hidden big:flex"
                  label="빠르기"
                  value={`${rate}×`}
                  onMinus={() => onRate(RATES[Math.max(rateIdx() - 1, 0)])}
                  onPlus={() =>
                    onRate(RATES[Math.min(rateIdx() + 1, RATES.length - 1)])
                  }
                  onReset={() => onRate(1)}
                  width="w-10"
                  minusTitle="느리게 (연습용)"
                  plusTitle="빠르게"
                />
              </span>
            </div>

            {/* 트랜스포트 — ⏮ ▶ ⏹ ⏭ + 탐색. AI 앱과 같은 줄 */}
            <div className="mt-2 flex items-center gap-2">
              <button
                className={`${circle} h-8 w-8 text-[10px]`}
                title={loopA !== null ? "반복 시작(A)으로" : "처음으로"}
                onClick={() => onSeek(loopA ?? 0)}
              >
                ⏮
              </button>
              <button
                className={`${circle} h-10 w-10 text-sm`}
                aria-label={playing ? "일시정지" : "재생"}
                onClick={() => (playing ? playback?.pause() : playback?.play())}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              {/* 정지는 일시정지와 다르다 — 멈추고 처음(반복 중이면 A)으로
              되돌아간다. 한 대목을 되풀이해 볼 때 손이 덜 간다 */}
              <button
                className={`${circle} h-8 w-8 text-[10px]`}
                title="정지 — 멈추고 처음으로"
                aria-label="정지"
                onClick={() => {
                  playback?.pause();
                  onSeek(loopA ?? 0);
                }}
              >
                ⏹
              </button>
              <button
                className={`${circle} h-8 w-8 text-[10px]`}
                title="끝으로"
                onClick={() => onSeek(Math.max(duration - 1, 0))}
              >
                ⏭
              </button>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
                {clock(now)}
              </span>
              <input
                type="range"
                className="seekbar min-w-0 flex-1"
                min={0}
                max={Math.max(duration, 1)}
                step={0.1}
                value={Math.min(now, duration)}
                onChange={(e) => onSeek(Number(e.target.value))}
              />
              <span className="w-10 shrink-0 text-xs tabular-nums text-gray-500">
                {clock(duration)}
              </span>
            </div>
          </section>

          {/* 악보 — 이 칸만 스크롤 */}
          <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
            {score}
          </section>
        </div>
      </div>
    </div>
  );
}
