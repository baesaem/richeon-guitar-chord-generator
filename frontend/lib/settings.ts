"use client";

import { useSyncExternalStore } from "react";

export type Notation = "auto" | "sharp" | "flat";

/** 재생 화면 본문에 무엇을 띄울지 */
export type View = "wave" | "sheet";

export interface Settings {
  /** 분석할 때 음원 분리를 쓸지 */
  separate: boolean;
  /** 파형 타임라인 확대 배율(초당 픽셀) */
  pixelsPerSecond: number;
  /** 코드 표기법. auto면 조표를 보고 정한다 */
  notation: Notation;
  /** 파형 / 코드악보 중 어느 쪽을 볼지 */
  view: View;
}

export const DEFAULT_SETTINGS: Settings = {
  separate: true,
  pixelsPerSecond: 90,
  notation: "auto",
  view: "wave",
};

const KEY = "chordgen.settings";

/**
 * localStorage를 감싼 작은 스토어.
 *
 * 마운트 이펙트에서 setState로 불러오면 렌더가 두 번 돌고, 서버 렌더 결과와도
 * 어긋난다. useSyncExternalStore로 읽으면 두 문제가 같이 사라진다.
 */
let cached: Settings | null = null;
const listeners = new Set<() => void>();

function read(): Settings {
  if (cached) return cached;   // 같은 참조를 돌려줘야 무한 렌더가 안 난다

  let value: Settings = DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) value = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // 저장값이 깨졌거나 접근이 막혔으면 기본값으로 간다
  }
  cached = value;
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(next: Settings): void {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 사생활 보호 모드 등에서 저장이 막혀도 이번 세션 동작에는 지장 없다
  }
  listeners.forEach((l) => l());
}

export function useSettings(): [Settings, (next: Settings) => void] {
  // 서버 렌더에서는 기본값을 쓴다. 클라이언트에서 저장값으로 한 번 맞춰진다.
  const value = useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS);
  return [value, write];
}
