"use client";

import { useEffect, useState } from "react";

/**
 * 재생 위치를 매 프레임 따라가는 시계.
 *
 * 화면 전체가 쓰는 time은 초당 네 번만 갱신된다 — 그 값이 바뀌면 앱이
 * 통째로 다시 그려지므로 더 자주 바꿀 수 없다. 그런데 진행 바가 그
 * 값을 쓰면 최대 0.25초 뒤처져 보인다.
 *
 * 그래서 진행 바를 그리는 창만 제 시계를 갖는다. 다시 그리는 것은 그
 * 창 하나뿐이라 무겁지 않다.
 *
 * getTime을 주지 않으면(재생기가 아직 없으면) 바깥 time을 그대로 쓴다.
 */
export function useSmoothTime(time: number, getTime?: () => number): number {
  const [now, setNow] = useState(time);

  useEffect(() => {
    if (!getTime) {
      setNow(time);
      return;
    }
    let raf = 0;
    let last = -1;
    const frame = () => {
      const t = getTime();
      // 30분의 1초보다 잘게 바꿔 봐야 눈에 띄지 않는다
      if (Math.abs(t - last) > 0.03) {
        last = t;
        setNow(t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [getTime, time]);

  return getTime ? now : time;
}
