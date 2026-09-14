/**
 * 폴더 칩(전체·즐겨찾기·초급반·노래방…)의 모양 — 음원목록·편집·노래방 목록이 함께 쓴다.
 *
 * 고르지 않은 칩은 테마의 panel 색을 바탕으로 썼는데, 테마에 따라 panel이 바닥과
 * 같아 칩이 보이지 않았다(강사님: 「폴더 리스트 테마에 포함」). 글자색에서 바탕·
 * 테두리를 뽑으면 글자가 보이는 테마에서는 칩도 보인다. 고른 칩은 테마마다 짝지은
 * pick/pick-ink. 테두리 두께를 같게 두어 고를 때 칩 크기가 흔들리지 않게 한다.
 */
export const folderChip = (on: boolean) =>
  [
    "rounded-full border px-2.5 py-1 text-xs",
    on
      ? "border-transparent bg-[var(--pick)] text-[var(--pick-ink)]"
      : "border-[color-mix(in_srgb,var(--foreground)_35%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--foreground)]",
  ].join(" ");
