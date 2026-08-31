"use client";

/**
 * 바깥 사이트 열기 — 새 창(탭)으로.
 *
 * 강좌를 눌렀다고 앱이 사라지면 곤란하다. 보던 자리로 돌아오려면
 * 뒤로 가기를 눌러야 하고, 설치된 앱(PWA)에서는 그마저 어색하다.
 *
 * 방법을 세 단계로 둔다.
 *  1) 진짜 링크를 만들어 누른다. 브라우저는 이것을 「사용자가 누른
 *     링크」로 보아 새 창을 막지 않는다 — window.open을 팝업으로 보고
 *     막는 웹앱·인앱 브라우저에서도 이 길은 열린다.
 *  2) 그래도 안 되면 window.open.
 *  3) 둘 다 막히면 이 창에서 연다. 앱을 떠나지만 아무 반응이 없는
 *     것보다는 낫다 — 기기에 저장된 곡은 돌아와도 그대로다.
 */
export function openLink(url: string): void {
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  } catch {
    // 아래로 물러난다
  }

  let opened: Window | null = null;
  try {
    opened = window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    opened = null;
  }
  if (!opened) window.location.href = url;
}
