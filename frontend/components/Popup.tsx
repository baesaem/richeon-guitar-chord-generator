"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 화면 중앙 팝업. 배경을 누르면 닫힌다. 하단 컨트롤과 가져오기 카드가 함께 쓴다.
 *
 * 앱 뿌리(.app-scale)에 포털로 그린다. 제자리에 그리면 조상 가운데 뒤 흐림
 * (backdrop-filter)이나 transform이 있는 상자가 fixed의 기준이 되어, 노래방
 * 위 줄(반투명)에서 연 연주설정이 그 48px 띠 안에 갇혀 잘렸다(강사님). body가
 * 아니라 .app-scale인 까닭은, 노래방이 그 상자를 90° 돌리므로 창도 함께 돌아야
 * 해서다.
 */
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
  // 서버 렌더에는 document가 없다 — 붙은 뒤에 자리를 정한다
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    setHost(document.querySelector(".app-scale") ?? document.body);
  }, []);
  if (!host) return null;
  return createPortal(
    <div
      className={`fixed inset-0 ${layer} flex items-center justify-center bg-black/50 p-6`}
      onClick={onClose}
    >
      <div
        /* 창도 테마를 따른다. 흰 종이로 박아 두었더니 어두운 테마에서
           흰 바탕에 흰 글자가 되어 아무것도 안 보였다 — 다크 짝을
           걷어내면서 함께 사라진 것이다. */
        /* 테두리를 두른다. 어두운 테마에서는 창 바탕과 뒤 화면이 둘 다
           검어 그림자만으로는 창의 가장자리가 보이지 않는다. */
        /* 높이 한도는 화면(dvh)이 아니라 덮개 상자 기준. 노래방은 앱을 통째로
           90° 돌린 상자 안에 그리는데, 세로로 든 폰에서 dvh는 긴 변이라 창이
           돌려진 상자의 짧은 변을 넘어 아래가 잘렸다(강사님). 덮개는 그 상자를
           가득 채우므로 그 85%면 어느 방향이든 든다 */
        className={`flex max-h-[85%] w-full ${width} flex-col rounded-xl border border-[var(--panel-line)] bg-[var(--background)] text-[var(--foreground)] shadow-xl`}
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
    </div>,
    host,
  );
}
