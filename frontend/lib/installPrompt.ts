"use client";

/**
 * 앱 설치(PWA) 안내.
 *
 * 브라우저는 설치 조건이 갖춰지면 beforeinstallprompt 를 **페이지가 열릴
 * 때 한 번** 던진다. 설정 화면이 열리기 전일 수 있으므로 이 모듈을
 * 불러오는 순간부터 잡아 둔다 — 버튼을 눌렀을 때 꺼내 쓴다.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let saved: InstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    saved = e as InstallPromptEvent;
  });
  // 설치가 끝나면 잡아 둔 프롬프트는 쓸모가 없다
  window.addEventListener("appinstalled", () => {
    saved = null;
  });
}

/** 지금 설치 창을 띄울 수 있는가 */
export function canPromptInstall(): boolean {
  return saved !== null;
}

/** 이미 앱(홈 화면 아이콘)으로 열려 있는가 */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS는 설치 창이 없고 공유 메뉴로만 설치한다 */
export function isIos(): boolean {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * 설치 창을 띄운다. 결과: "accepted" 설치함, "dismissed" 사용자가 닫음,
 * null 은 띄울 수 없는 환경(iOS·이미 설치됨·조건 미충족).
 */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | null
> {
  if (!saved) return null;
  const event = saved;
  saved = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}
