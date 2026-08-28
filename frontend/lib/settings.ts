"use client";

import { useSyncExternalStore } from "react";

export type Notation = "auto" | "sharp" | "flat";

/** 재생 화면 본문에 무엇을 띄울지 */
export type View = "wave" | "sheet" | "melody";

/** 화면 테마. system은 기기 설정을 따른다 */
export type Theme = "system" | "light" | "dark" | "sepia" | "aqua" | "royal" | "naver";

export interface Settings {
  /** 분석할 때 음원 분리를 쓸지 */
  separate: boolean;
  /** 파형 타임라인 확대 배율(초당 픽셀) */
  pixelsPerSecond: number;
  /** 코드 표기법. auto면 조표를 보고 정한다 */
  notation: Notation;
  /** 코드악보 / 멜로디 / 파형 중 어느 쪽을 볼지 */
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
  /**
   * 기기 지연 보정(초). 소리가 화면보다 늦게 나오는 만큼 화면을 늦춘다.
   *
   * 브라우저가 알려 주는 출력 지연을 그대로 쓴다. 곡이 아니라 기기의
   * 성질이라 곡마다가 아니라 여기에 둔다 — 한 번 정해지면 모든 곡에
   * 적용된다.
   */
  latency: number;
  /** 관리자 모드. 공유 폴더 관리 기능(드라이브 열기 등)이 보인다 */
  adminMode: boolean;
  /** 관리자 로그인 유지. 끄면 브라우저를 닫을 때 관리자 모드가 풀린다 */
  adminKeep: boolean;
  /**
   * 코드 어휘. basic이면 확장 화음을 3화음·세븐스로 낮춰 보여준다.
   * (인식 결과는 그대로 두고 화면 표기만 바꾼다.)
   */
  chordVocab: "basic" | "all";
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
  latency: 0,
  adminMode: false,
  adminKeep: true,
  chordVocab: "all",
};

const KEY = "chordgen.settings";
// 로그인 유지를 끈 관리자 세션의 표식. sessionStorage라 브라우저를 닫으면 사라진다.
const ADMIN_SESSION_KEY = "chordgen.adminSession";

/** PIN 통과 시 호출. 이 브라우저 세션 동안 관리자임을 표시한다. */
export function markAdminSession(): void {
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  } catch {
    // 저장이 막혀도 로그인 유지 켬과 같은 동작이 될 뿐이다
  }
}

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
    // 관리자 모드는 스스로 끄기 전까지 유지된다.
    //
    // 예전에는 「로그인 유지」를 끄면 브라우저를 닫을 때 풀리게 했는데,
    // 설치한 앱·미리보기 창은 세션이 자주 갈려 곡을 올리려 할 때마다
    // 비밀번호를 다시 묻는 꼴이 됐다. 이 앱은 강사님 기기에서만 관리자
    // 모드를 켜므로, 켠 상태를 그대로 두는 편이 맞다.
    if (value.adminMode) value = { ...value, adminKeep: true };
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
