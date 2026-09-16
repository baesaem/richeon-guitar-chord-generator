"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 작업 중 표시.
 *
 * 화면 한가운데. 몇 초씩 걸리는 일에는 버튼 글자만 바꿔서는 부족하다 —
 * 눌렀는지 아닌지 몰라 또 누르게 된다.
 *
 * 멈출 수 있는 일(여러 곡 내보내기)에는 onCancel을 준다 — 이 창이
 * 화면을 다 덮으므로, 멈출 길이 없으면 오래 걸릴 때 앱이 죽은 것과
 * 같아진다. 실제로 「앱이 멈췄다」는 말이 그것이었다.
 *
 * 진행 막대는 받은 값 사이를 **부드럽게 잇는다**(강사님: 「진행바가 느림」).
 * 서버는 한 단계가 끝나야 값을 올려 주므로 그대로 그리면 1분씩 멈췄다가
 * 한꺼번에 뛴다. 다음 값이 올 때까지 시간에 맞춰 조금씩 밀되, 받은 값보다
 * 너무 앞서지는 않는다(100%는 끝났을 때만).
 *
 * 단계 목록(steps)을 주면 어느 단계인지(끝난 단계 ✓), 흐른 시간이 함께 보이고,
 * 막대는 「단계 수 · 이 단계가 보통 걸리는 시간(expectSec) · 서버가 알려 준
 * 몇 번째(stepDone/stepTotal)」로 전체 진행을 가늠한다(악보 붙이기).
 */
export function Working({
  label,
  note,
  progress,
  onCancel,
  steps,
  stepIndex = 0,
  stepDone,
  stepTotal,
  expectSec = 30,
}: {
  label: string;
  /** 지금 무엇을 하는 중인지 한 줄 */
  note?: string;
  /** 0~1. 알 수 없으면 넘기지 않는다 */
  progress?: number;
  /** 있으면 「멈추기」 단추가 붙는다 */
  onCancel?: () => void;
  /** 단계 이름들. 주면 단계 목록·흐른 시간이 보이고 막대를 단계로 가늠한다 */
  steps?: string[];
  /** 지금 단계(0부터) */
  stepIndex?: number;
  /** 이 단계에서 서버가 알려 준 끝난 수 / 전체 수(AI 읽기) */
  stepDone?: number;
  stepTotal?: number;
  /** 이 단계가 보통 몇 초 걸리나 — 막대를 시간으로 밀 때 쓴다 */
  expectSec?: number;
}) {
  const startedAt = useRef(Date.now());
  const stepStartedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [shown, setShown] = useState(0);

  // 단계가 바뀌면 그 단계의 시계를 새로 잰다
  useEffect(() => {
    stepStartedAt.current = Date.now();
  }, [stepIndex]);

  /** 받은 값(또는 단계로 가늠한 값) — 막대가 따라갈 목표 */
  const target = (() => {
    if (steps?.length) {
      const inStep = (now - stepStartedAt.current) / 1000;
      // 시간으로 가늠한 이 단계의 몫 — 보통 걸리는 시간이면 약 63%, 끝나기 전엔 95%까지
      const byTime = Math.min(0.95, 1 - Math.exp(-inStep / Math.max(expectSec, 1)));
      let frac = byTime;
      if (stepTotal && stepTotal > 0) {
        const done = Math.min(stepDone ?? 0, stepTotal);
        // 서버가 알려 준 몫을 바닥으로, 다음 하나가 끝나기 전까지만 시간으로 민다
        frac = Math.max(done / stepTotal, Math.min(byTime, (done + 0.9) / stepTotal));
      }
      return Math.min(1, (Math.min(stepIndex, steps.length - 1) + frac) / steps.length);
    }
    return progress;
  })();

  // 0.2초마다 막대를 목표로 잇는다. 목표보다 뒤면 빠르게 따라가고, 목표에 닿았으면
  // 다음 값이 올 때까지 아주 조금씩 민다(목표보다 8% 넘게 앞서지 않게)
  useEffect(() => {
    if (target === undefined) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      setShown((s) => {
        if (s < target) return s + Math.max((target - s) * 0.3, 0.002);
        const cap = Math.min(0.97, target + 0.08);
        return s < cap ? s + 0.0008 : s;
      });
    }, 200);
    return () => window.clearInterval(t);
  }, [target]);

  const elapsed = Math.floor((now - startedAt.current) / 1000);
  const elapsedText =
    elapsed >= 60 ? `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초` : `${elapsed}초`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      role="status"
      aria-live="polite"
    >
      <div
        className={[
          "w-full rounded-2xl border border-[var(--panel-line)] bg-[var(--background)] p-5 text-center text-[var(--foreground)] shadow-xl",
          steps?.length ? "max-w-[300px]" : "max-w-[220px]",
        ].join(" ")}
      >
        <span
          className="mx-auto mb-3 block h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--accent)] border-t-transparent"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{label}</p>
        {note && (
          <p
            className={[
              "mt-0.5 text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]",
              steps?.length ? "break-keep" : "truncate",
            ].join(" ")}
          >
            {note}
          </p>
        )}
        {target !== undefined && (
          <>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--chip)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${Math.max(3, Math.round(shown * 100))}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] tabular-nums text-[var(--accent)]">
              {Math.round(shown * 100)}%
              {steps?.length ? (
                <span className="text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                  {" "}
                  · {elapsedText}
                </span>
              ) : null}
            </p>
          </>
        )}
        {steps?.length ? (
          <ol className="mt-3 space-y-1 text-left text-[11px]">
            {steps.map((s, i) => (
              <li
                key={s}
                className={
                  i < stepIndex
                    ? "opacity-60"
                    : i === stepIndex
                      ? "font-semibold text-[var(--accent)]"
                      : "opacity-40"
                }
              >
                <span className="mr-1.5 inline-block w-3 text-center">
                  {i < stepIndex ? "✓" : i === stepIndex ? "▸" : "·"}
                </span>
                {s}
              </li>
            ))}
          </ol>
        ) : null}
        {onCancel && (
          <button
            className="mt-3 w-full rounded-lg bg-[var(--panel)] py-2 text-xs font-medium text-[var(--foreground)]"
            onClick={onCancel}
          >
            멈추기
          </button>
        )}
      </div>
    </div>
  );
}
