"use client";

export type Tab =
  | "home"
  /** 연주기 — 탭이 아니라 전체보기 창을 여는 자리다 */
  | "player"
  | "library"
  | "import"
  | "lesson"
  | "edit"
  | "chords"
  | "settings";

interface Props {
  tab: Tab;
  onChange: (tab: Tab) => void;
}

/** 주메뉴 항목. 폰의 아래 탭과 태블릿·PC의 왼쪽 사이드바가 함께 쓴다 */
export const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "home",
    label: "홈",
    icon: <path d="M3 10.5 12 3l9 7.5V21H3z" />,
  },
  {
    id: "player",
    label: "연주기",
    icon: (
      <>
        {/* 악보대 위의 재생 — 지금 곡을 큰 화면으로 편다 */}
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M3 8h18" />
        <path d="M10.5 11v4l3.5-2z" />
        <path d="M12 17v3M8.5 20h7" />
      </>
    ),
  },
  {
    id: "library",
    label: "음원목록",
    icon: (
      <>
        <path d="M3 6h12M3 11h12M3 16h7" />
        <circle cx="17.5" cy="17" r="3" />
        <path d="M20.5 17V8l2.5 1.2" />
      </>
    ),
  },
  {
    id: "lesson",
    label: "공부방",
    icon: (
      <>
        {/* 펼친 책 — 따로 듣는 강좌를 모아 두는 자리 */}
        <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2z" />
        <path d="M12 6.5v13" />
      </>
    ),
  },
  {
    id: "import",
    label: "음원가져오기",
    icon: (
      <>
        <path d="M12 3.5v10M8.5 10 12 13.5 15.5 10" />
        <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </>
    ),
  },
  {
    id: "edit",
    label: "코드수정",
    icon: (
      <>
        <path d="M4 20h4L20 8l-4-4L4 16z" />
        <path d="M14.5 5.5 18.5 9.5" />
      </>
    ),
  },
  {
    id: "chords",
    label: "기타 기초",
    icon: (
      <>
        <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
        <path d="M8 3.5v17M12 3.5v17M16 3.5v17M4 9h16M4 15h16" />
      </>
    ),
  },
  {
    id: "settings",
    label: "설정",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
      </>
    ),
  },
];

/** 화면 맨 아래 탭 막대. 폰에서 엄지로 누르는 자리라 세로 여백을 넉넉히 둔다.
 *  테마 강조색이 활성 탭에 물든다. 넓은 화면에서는 왼쪽 사이드바가
 *  대신하므로 숨는다(md 이상). */
export function BottomNav({ tab, onChange }: Props) {
  return (
    <nav className="shrink-0 bg-[var(--bar-bg)] shadow-[0_-4px_16px_rgba(0,0,0,0.07)] roomy:hidden">
      {/* 강조색 헤어라인 */}
      <div className="h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--accent)_45%,transparent)] to-transparent" />
      <div className="flex">
        {NAV_ITEMS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              aria-current={active ? "page" : undefined}
              className={[
                // 탭이 6개라 한 칸이 좁다. min-w-0으로 라벨이 칸을 밀어내지 않게 한다.
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 pb-2 pt-1.5 transition-colors",
                active ? "text-[var(--accent)]" : "text-gray-400",
              ].join(" ")}
            >
              {/* 활성 탭은 은은한 알약 배경으로 감싼다 */}
              <span
                className={[
                  "flex items-center justify-center rounded-full px-3 py-0.5 transition-colors",
                  active
                    ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                    : "bg-transparent",
                ].join(" ")}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.1 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {item.icon}
                </svg>
              </span>
              <span
                className={[
                  "w-full truncate text-center text-[9px] leading-none",
                  active ? "font-semibold" : "",
                ].join(" ")}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
