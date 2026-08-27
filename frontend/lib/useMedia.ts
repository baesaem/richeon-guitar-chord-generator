"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 화면 크기 질문에 지금 답을 준다.
 *
 * CSS만으로 감추고 보이는 것은 클래스로 되지만, "넓은 화면이면 악보를
 * 몇 줄 보일까" 같은 것은 값 자체가 달라져야 해서 자바스크립트가 알아야
 * 한다. 서버 렌더에서는 false — 폰 기준으로 먼저 그리고, 화면에 붙는
 * 순간 넓은 화면 값으로 맞춘다.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** 태블릿·PC 폭인가(사이드바가 서는 크기) */
export const useWideScreen = () => useMediaQuery("(min-width: 768px)");
