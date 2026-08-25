"use client";

export type Tab = "home" | "library" | "mic" | "chords" | "settings";

interface Props {
  tab: Tab;
  onChange: (tab: Tab) => void;
}

const ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "home",
    label: "홈",
    icon: <path d="M3 10.5 12 3l9 7.5V21H3z" />,
  },
  {
    id: "library",
    label: "재생목록",
    icon: (
      <>
        <path d="M3 6h12M3 11h12M3 16h7" />
        <circle cx="17.5" cy="17" r="3" />
        <path d="M20.5 17V8l2.5 1.2" />
      </>
    ),
  },
  {
    id: "mic",
    label: "마이크",
    icon: (
      <>
        <rect x="9" y="2.5" width="6" height="11" rx="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
      </>
    ),
  },
  {
    id: "chords",
    label: "코드리스트",
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

/** 화면 맨 아래 탭 막대. 폰에서 엄지로 누르는 자리라 세로 여백을 넉넉히 둔다. */
export function BottomNav({ tab, onChange }: Props) {
  return (
    <nav className="flex shrink-0 border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-black">
      {ITEMS.map((item) => {
        const active = item.id === tab;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            aria-current={active ? "page" : undefined}
            className={[
              "flex flex-1 flex-col items-center gap-0.5 py-2",
              active ? "text-black dark:text-white" : "text-gray-400",
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
            <span className="text-[10px] leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
