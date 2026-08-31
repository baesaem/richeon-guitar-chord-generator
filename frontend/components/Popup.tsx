"use client";

/** 화면 중앙 팝업. 배경을 누르면 닫힌다. 하단 컨트롤과 가져오기 카드가 함께 쓴다. */
export function Popup({
  title,
  onClose,
  children,
  width = "max-w-sm",
  layer = "z-50",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 창 최대 너비 클래스. 콤팩트한 창은 max-w-xs를 넘긴다 */
  width?: string;
  /**
   * 몇 겹째 창인가. 창 위에 다시 묻는 창(「새 것으로 바꿀까요?」)은
   * 더 위여야 한다 — 같은 층에 두면 나중에 그려진 목록 창에 가려
   * 물어보는 말이 보이지 않는다.
   */
  layer?: string;
}) {
  return (
    <div
      className={`fixed inset-0 ${layer} flex items-center justify-center bg-black/50 p-6`}
      onClick={onClose}
    >
      <div
        /* 창도 테마를 따른다. 흰 종이로 박아 두었더니 어두운 테마에서
           흰 바탕에 흰 글자가 되어 아무것도 안 보였다 — 다크 짝을
           걷어내면서 함께 사라진 것이다. */
        className={`flex max-h-[85dvh] w-full ${width} flex-col rounded-xl bg-[var(--background)] text-[var(--foreground)] shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 제목줄은 고정. 긴 창(연주설정)을 내려도 이름과 닫기가 남는다 */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            className="rounded px-2 py-1 text-sm text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
