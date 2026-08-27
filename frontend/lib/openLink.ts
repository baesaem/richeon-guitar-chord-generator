"use client";

/**
 * 바깥 사이트 열기.
 *
 * `target="_blank"`만으로는 열리지 않는 환경이 있다. 폰의 웹앱·인앱
 * 브라우저는 새 창을 막는데, 그러면 눌러도 아무 일이 안 일어난다
 * (prompt()가 막히던 것과 같은 부류다).
 *
 * 새 창이 막히면 이 창에서 연다. 앱을 떠나게 되지만, 아무 반응이 없는
 * 것보다는 낫다 — 뒤로 가기로 돌아오면 기기에 저장된 곡은 그대로 있다.
 */
export function openLink(url: string): void {
  let opened: Window | null = null;
  try {
    opened = window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    opened = null;
  }
  if (!opened) window.location.href = url;
}
