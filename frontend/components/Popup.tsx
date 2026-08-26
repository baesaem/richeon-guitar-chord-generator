"use client";

/** 화면 중앙 팝업. 배경을 누르면 닫힌다. 하단 컨트롤과 가져오기 카드가 함께 쓴다. */
export function Popup({
  title,
  onClose,
  children,
  width = "max-w-sm",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 창 최대 너비 클래스. 콤팩트한 창은 max-w-xs를 넘긴다 */
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className={`max-h-[85dvh] w-full ${width} overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-gray-900`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">{title}</h3>
          <button
            className="rounded px-2 py-1 text-sm text-gray-500"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
