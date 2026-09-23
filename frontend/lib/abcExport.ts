"use client";

/**
 * 멜로디 악보(ABC)를 파일로 내보낸다 — 편집 화면의 「ABC 내보내기」(강사님).
 *
 * 곡에 붙은 ABC 원문을 그대로 `.abc` 파일로 내려받는다. 뮤즈스코어·EasyABC
 * 같은 다른 프로그램에서 열어 고치거나, 다른 곡에 붙일 때 쓴다. 제목이 「제목
 * 없음」이면 곡 이름을 T: 줄에 넣어 준다 — 파일만 봐도 무슨 곡인지 알게.
 */

/** 파일 이름에 못 쓰는 글자를 걷어 낸다 */
function safeName(text: string): string {
  return text.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60) || "악보";
}

export function abcFileName(title: string): string {
  return `${safeName(title)}.abc`;
}

/** 내려받을 ABC 본문. 제목이 비었으면 곡 이름을 넣는다 */
export function abcForExport(abc: string, title: string): string {
  const t = title.trim();
  if (!t) return abc;
  if (!/^T:/m.test(abc)) return abc.replace(/^(X:.*\n)?/, (x) => `${x}T:${t}\n`);
  return abc.replace(/^T:\s*(제목 없음)?\s*$/m, `T:${t}`);
}

export function downloadAbc(abc: string, title: string): void {
  // text/plain으로 주면 브라우저가 .txt를 덧붙이기도 한다 — 확장자를 지키게 octet-stream으로
  const blob = new Blob([abcForExport(abc, title)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = abcFileName(title);
  a.click();
  URL.revokeObjectURL(url);
}
