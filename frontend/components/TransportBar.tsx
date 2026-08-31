"use client";

import { useState } from "react";

import { ArpPickModal } from "@/components/ArpPick";
import { Popup } from "@/components/Popup";
import { StrumPickModal } from "@/components/StrumPick";
import { useSettings } from "@/lib/settings";
import type { StemChoice } from "@/lib/sharedFiles";
import type { StrumChoice } from "@/lib/strumLibrary";

interface Props {
  duration: number;
  time: number;
  playing: boolean;
  transpose: number;
  rate: number;
  loop: { a: number; b: number } | null;
  /** 코드 싱크 보정(초) */
  sync: number;
  /** 가사 싱크 보정(초) */
  lyricSync: number;
  onSeek: (t: number) => void;
  onToggle: () => void;
  onTranspose: (semitones: number) => void;
  onRate: (rate: number) => void;
  onLoop: (loop: { a: number; b: number } | null) => void;
  onSync: (sec: number) => void;
  onLyricSync: (sec: number) => void;
  /** 주법. 0 = 스트로크, 1~ = 아르페지오 패턴 번호 */
  arp?: number;
  onArp?: (no: number) => void;
  /** 악보에 코드를 얹을지(곡마다). 멜로디만 그려진 악보에 쓴다 */
  autoChords?: boolean;
  onAutoChords?: (on: boolean) => void;
  /** 아르페지오 패턴 추천에 쓴다 */
  timeSignature?: string;
  bpm?: number;
  /** 직접 고른 스트로크 패턴 이름. 빈 문자열이면 자동 추천 */
  strumName?: string;
  onStrumName?: (name: string) => void;
  /** 이 곡의 스트로크 자동 추천(이유 포함) */
  strumRec?: StrumChoice;
  /** 음원 분리. 서버가 있거나 기기에 트랙이 있으면 된다 */
  stem?: StemChoice;
  onStem?: (next: StemChoice) => void;
  /** 반주를 준비하는 중이면 스위치를 잠근다 */
  vocalBusy?: boolean;
  vocalError?: string | null;
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
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--panel-line)] px-3 py-1.5">
      <button
        className="h-9 w-9 shrink-0 rounded-full bg-black text-white dark:bg-white dark:text-black"
        onClick={onToggle}
        aria-label={playing ? "일시정지" : "재생"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
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
      <span className="w-10 shrink-0 text-xs tabular-nums text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
        {clock(duration)}
      </span>
    </div>
  );
}

/** 음높이(이조·카포)·빠르기·반복을 한 팝업에 모은 「연주설정」 버튼.
 *  파형/코드악보 전환 줄의 영상접기 왼쪽에 놓인다. */
export function PlaySettings(props: Omit<Props, "playing" | "onSeek" | "onToggle">) {
  const { duration, time, transpose, rate, loop, sync, lyricSync } = props;
  const [open, setOpen] = useState(false);
  // 아르페지오·스트로크 패턴 고르기 창
  const [arpPick, setArpPick] = useState(false);
  const [strumPick, setStrumPick] = useState(false);
  const [settings, setSettings] = useSettings();

  const pill = (active: boolean) =>
    [
      "rounded px-0 py-1 text-xs",
      active
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "bg-[var(--panel)]",
    ].join(" ");

  const sectionTitle = "mb-1 mt-0 text-xs font-semibold text-[var(--accent)]";

  // 음높이 +n = 카포 n프렛. 카포가 소리를 올려주는 만큼 화면 코드는
  // 내린 모양으로 표기된다(표기 변환은 page.tsx의 noteShift가 담당).
  const capo = transpose > 0 ? transpose : 0;
  // 기본값에서 벗어난 설정이 있으면 버튼에 점을 찍어 알린다
  const arp = props.arp ?? 0;
  const tweaked =
    transpose !== 0 ||
    rate !== 1 ||
    loop !== null ||
    sync !== 0 ||
    lyricSync !== 0 ||
    arp !== 0;

  return (
    <>
      <button
        className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--chip)] px-2 py-1.5 text-[13px] font-medium text-[var(--foreground)] roomy:gap-1.5 roomy:px-3 roomy:py-2.5 roomy:text-[16px]"
        onClick={() => setOpen(true)}
        title="음높이·빠르기·반복"
      >
        {/* 슬라이더(조절) 아이콘 */}
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 roomy:h-4 roomy:w-4"
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
        <Popup title="연주설정" width="max-w-xs" onClose={() => setOpen(false)}>
          {/* ---- 코드 어휘 ---- */}
          <div className={sectionTitle}>코드</div>
          <div className="mb-2 grid grid-cols-2 gap-1">
            {(
              [
                ["basic", "기본"],
                ["all", "전부"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={pill(settings.chordVocab === value)}
                onClick={() => setSettings({ ...settings, chordVocab: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mb-2 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            기본은 7th·sus 같은 확장 화음을 쉬운 3화음으로 낮춰 보여줍니다.
          </p>

          {/* ---- 주법 (스트로크 / 아르페지오) ----
              번호 칩을 늘어놓지 않는다. 아르페지오를 누르면 곡에 맞는
              패턴을 추천하고 운지 타브를 미리 보여주는 창이 뜬다. */}
          {props.onArp && (
            <>
              <div className={sectionTitle}>
                주법
                {arp > 0
                  ? ` · 아르페지오 ${arp}`
                  : props.strumName
                    ? ` · ${props.strumName}`
                    : ""}
              </div>
              <div className="mb-1.5 grid grid-cols-2 gap-1">
                <button className={pill(arp === 0)} onClick={() => setStrumPick(true)}>
                  스트로크{arp === 0 && props.strumName ? ` · ${props.strumName}` : ""}
                </button>
                <button className={pill(arp > 0)} onClick={() => setArpPick(true)}>
                  아르페지오{arp > 0 ? ` ${arp}` : ""}
                </button>
              </div>
              <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                누르면 이 곡에 맞는 패턴을 추천하고 미리 보여줍니다. 고른
                패턴대로 악보가 그려집니다.
              </p>
              <div className="my-2.5 h-px bg-[var(--chip)]" />
              {arpPick && (
                <ArpPickModal
                  current={arp}
                  timeSignature={props.timeSignature ?? "4/4"}
                  bpm={props.bpm ?? 0}
                  onPick={(no) => props.onArp?.(no)}
                  onClose={() => setArpPick(false)}
                />
              )}
              {strumPick && props.strumRec && (
                <StrumPickModal
                  current={props.strumName ?? ""}
                  rec={props.strumRec}
                  onPick={(name) => {
                    // 스트로크를 골랐다는 것은 스트로크로 치겠다는 뜻이다
                    props.onArp?.(0);
                    props.onStrumName?.(name);
                  }}
                  onClose={() => setStrumPick(false)}
                />
              )}
            </>
          )}

          {/* ---- 음높이 (이조 + 카포) ---- */}
          <div className={sectionTitle}>
            음높이
            {transpose !== 0 &&
              ` · ${transpose > 0 ? "+" : ""}${transpose}${capo ? ` (카포 ${capo})` : ""}`}
          </div>
          <div className="mb-2 flex items-center gap-2">
            <button
              className="h-8 w-8 rounded bg-[var(--panel)]"
              onClick={() => props.onTranspose(Math.max(transpose - 1, -11))}
            >
              −
            </button>
            <div className="flex-1 text-center">
              <div className="text-xl font-bold leading-tight tabular-nums">
                {transpose > 0 ? `+${transpose}` : transpose}
              </div>
              <div className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                {transpose === 0
                  ? "원래 조"
                  : transpose > 0
                    ? `카포 ${transpose}프렛`
                    : "표기만 내려감"}
              </div>
            </div>
            <button
              className="h-8 w-8 rounded bg-[var(--panel)]"
              onClick={() => props.onTranspose(Math.min(transpose + 1, 11))}
            >
              +
            </button>
          </div>

          <div className="mb-1 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">카포 위치</div>
          <div className="mb-2 grid grid-cols-6 gap-1">
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
          <button
            className="w-full rounded bg-[var(--panel)] py-1 text-xs"
            onClick={() => props.onTranspose(0)}
          >
            초기화
          </button>

          {/* ---- 빠르기 ---- */}
          <div className="my-2.5 h-px bg-[var(--chip)]" />
          <div className={sectionTitle}>빠르기{rate !== 1 && ` · ${rate}×`}</div>
          <div className="grid grid-cols-5 gap-1">
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

          {/* ---- 반복 (A-B 구간) ---- */}
          <div className="my-2.5 h-px bg-[var(--chip)]" />
          <div className={sectionTitle}>구간 반복{loop && " · 사용 중"}</div>
          <div className="mb-2 grid grid-cols-2 gap-1.5 text-center">
            <div className="rounded border border-[var(--panel-line)] p-1.5">
              <div className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">시작 (A)</div>
              <div className="text-base font-bold leading-tight tabular-nums">
                {loop ? clock(loop.a) : "—"}
              </div>
            </div>
            <div className="rounded border border-[var(--panel-line)] p-1.5">
              <div className="text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">끝 (B)</div>
              <div className="text-base font-bold leading-tight tabular-nums">
                {loop ? clock(loop.b) : "—"}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              className="flex-1 rounded bg-[var(--panel)] py-1.5 text-xs"
              onClick={() =>
                props.onLoop({ a: time, b: Math.max(loop?.b ?? duration, time + 1) })
              }
            >
              지금을 시작으로
            </button>
            <button
              className="flex-1 rounded bg-[var(--panel)] py-1.5 text-xs"
              onClick={() => props.onLoop({ a: Math.min(loop?.a ?? 0, time), b: time })}
            >
              지금을 끝으로
            </button>
            <button
              className="flex-1 rounded bg-[var(--panel)] py-1.5 text-xs text-[var(--foreground)]"
              onClick={() => props.onLoop(null)}
            >
              해제
            </button>
          </div>
          {/* ---- 음원 분리 ---- */}
          {props.onStem && (
            <>
              <div className="my-2.5 h-px bg-[var(--chip)]" />
              <div className={sectionTitle}>
                음원 분리
                {props.vocalBusy && (
                  <span className="ml-1 text-[11px] font-normal text-[var(--accent)]">
                    트랙 만드는 중…
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                {(
                  [
                    ["off", "원음"],
                    ["inst", "반주"],
                    ["vocals", "보컬"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    disabled={props.vocalBusy}
                    onClick={() => props.onStem?.(value)}
                    className={[
                      "flex-1 disabled:opacity-40",
                      pill((props.stem ?? "off") === value),
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                반주는 노래를 지우고, 보컬은 반주를 지웁니다. 처음 한 번은
                만드는 데 시간이 걸립니다.
              </p>
              {props.vocalError && (
                <p className="mt-1 rounded bg-red-50 p-2 text-[11px] text-red-700">
                  {props.vocalError}
                </p>
              )}
            </>
          )}

          {/* ---- 악보에 코드 넣기 ---- */}
          {props.onAutoChords && (
            <>
              <div className="my-2.5 h-px bg-[var(--chip)]" />
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!props.autoChords}
                  onChange={(e) => props.onAutoChords?.(e.target.checked)}
                />
                <span>
                  <span className="text-sm font-medium">악보에 코드 넣기</span>
                  <span className="block text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                    멜로디만 그려진 악보에 음원에서 딴 코드를 얹습니다.
                    코드가 이미 적힌 악보에는 켜지 마세요 — 글자가 겹칩니다.
                  </span>
                </span>
              </label>
            </>
          )}

          <div className="my-2.5 h-px bg-[var(--chip)]" />

          {/* ---- 싱크 맞추기 ---- */}
          <div className="my-2.5 h-px bg-[var(--chip)]" />
          <div className="mb-1 text-sm font-medium">싱크 맞추기</div>
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
            소리보다 화면이 빠르면 −, 느리면 +. 블루투스 스피커는 소리가
            늦게 나와 보정이 필요합니다.
          </p>
          {(
            [
              ["코드", sync, props.onSync],
              ["가사", lyricSync, props.onLyricSync],
            ] as const
          ).map(([label, value, set]) => (
            <div key={label} className="mb-1.5 flex items-center gap-1.5">
              <span className="w-7 shrink-0 text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">{label}</span>
              <button
                className="rounded bg-[var(--panel)] px-2 py-1 text-xs"
                onClick={() => set(Math.round((value - 0.1) * 10) / 10)}
              >
                −
              </button>
              <span className="w-14 text-center text-xs tabular-nums">
                {value > 0 ? "+" : ""}
                {value.toFixed(1)}초
              </span>
              <button
                className="rounded bg-[var(--panel)] px-2 py-1 text-xs"
                onClick={() => set(Math.round((value + 0.1) * 10) / 10)}
              >
                +
              </button>
              {value !== 0 && (
                <button
                  className="ml-auto text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] underline"
                  onClick={() => set(0)}
                >
                  되돌리기
                </button>
              )}
            </div>
          ))}
        </Popup>
      )}
    </>
  );
}
