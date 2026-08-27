"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 길게 누르기 / 오른쪽 클릭.
 *
 * 재생하면서 고치기 때문에 짧은 탭으로 편집창이 열리면 곤란하다 — 마디를
 * 눌러 그 자리로 건너뛰는 동작과 부딪친다. 그래서 한참 눌러야 열린다.
 *
 * 얼마나 눌렀는지 되돌려 준다. 이게 없으면 사용자는 눌러도 아무 일이
 * 없다고 느껴 손을 뗀다 — 마디가 서서히 물드는 것을 보여줘야 "지금
 * 눌리고 있구나" 하고 기다린다.
 */
export function useLongPress(onFire: () => void, ms: number) {
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const fire = useRef(onFire);
  // 최신 콜백을 붙잡아 둔다. 렌더 중에 ref를 건드리면 안 되므로 효과에서.
  useEffect(() => {
    fire.current = onFire;
  }, [onFire]);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    timer.current = null;
    raf.current = null;
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    stop();
    const began = performance.now();
    const tick = () => {
      setProgress(Math.min(1, (performance.now() - began) / ms));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    timer.current = window.setTimeout(() => {
      stop();
      fire.current();
    }, ms);
  }, [ms, stop]);

  return {
    progress,
    handlers: {
      onPointerDown: start,
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onContextMenu: (e: React.MouseEvent) => {
        // 마우스 오른쪽 클릭은 기다릴 것 없이 바로 연다
        e.preventDefault();
        stop();
        fire.current();
      },
    },
  };
}
