"use client";

import { useSyncExternalStore } from "react";

export type Notation = "auto" | "sharp" | "flat";

/** 재생 화면 본문에 무엇을 띄울지 */
export type View = "wave" | "sheet";

/** 화면 테마. system은 기기 설정을 따른다 */
export type Theme = "system" | "light" | "dark" | "sepia" | "aqua" | "royal" | "naver";

export interface Settings {
  /** 분석할 때 음원 분리를 쓸지 */
  separate: boolean;
  /** 파형 타임라인 확대 배율(초당 픽셀) */
  pixelsPerSecond: number;
  /** 코드 표기법. auto면 조표를 보고 정한다 */
  notation: Notation;
  /** 파형 / 코드악보 중 어느 쪽을 볼지 */
  view: View;
  /** 영상을 접어 코드 표시에 자리를 넘길지 */
  videoCompact: boolean;
  /**
   * 분석 서버 주소. 비우면 같은 주소(집 안 사용) 또는 빌드 시 지정된 값을 쓴다.
   * 정적 배포본(GitHub Pages 등)에서 집 서버를 가리킬 때 쓴다.
   */
  apiBase: string;
  /** 분석이 끝나면 결과를 기기(IndexedDB)에도 저장해 서버 없이 열 수 있게 한다 */
  autoSave: boolean;
  /** 화면 테마 */
  theme: Theme;
  /** 곡 전체 코드 그리드를 펼쳐 둘지 */
  showGrid: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  separate: true,
  pixelsPerSecond: 90,
  notation: "auto",
  view: "wave",
  videoCompact: false,
  apiBase: "",
  autoSave: true,
  theme: "system",
  showGrid: true,
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

/** 훅 밖(예: API 클라이언트)에서 현재 설정을 읽는다. 서버 렌더에서는 기본값. */
export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  return read();
}

export function useSettings(): [Settings, (next: Settings) => void] {
  // 서버 렌더에서는 기본값을 쓴다. 클라이언트에서 저장값으로 한 번 맞춰진다.
  const value = useSyncExternalStore(subscribe, read, () => DEFAULT_SETTINGS);
  return [value, write];
}
