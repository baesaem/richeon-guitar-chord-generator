"use client";

import Image from "next/image";

import { NAV_ITEMS, type Tab } from "@/components/BottomNav";

/**
 * 태블릿·PC용 왼쪽 주메뉴.
 *
 * 폰은 엄지가 닿는 아래쪽 탭이 맞지만, 화면이 넓어지면 아래 탭은
 * 가로로 늘어져 허전하고 본문 높이만 깎는다. 넓은 화면에서는 메뉴를
 * 왼쪽 기둥으로 세우고 위에 앱 이름을 얹는다 — 눈이 왼쪽 위에서
 * 시작해 오른쪽 본문으로 흐른다.
 */
export function SideNav({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="hidden w-56 shrink-0 flex-col bg-[var(--bar-bg)] roomy:flex lg:w-60">
      {/* 앱 이름 — 사이드바 머리 */}
      <div className="flex items-center gap-3 px-4 py-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]">
          <Image
            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/guitar.png`}
            alt=""
            width={20}
            height={32}
            className="h-8 w-auto"
            priority
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[20px] font-bold leading-tight tracking-tight">
            <span className="text-[var(--accent)]">리천</span> 기타교실
          </span>
          <span className="block text-[12px] leading-tight text-[var(--accent)] opacity-75">
            강상주민센터 기타반 · 종영민 강사님
          </span>
        </span>
      </div>

      <div className="mx-4 h-px bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_45%,transparent)] to-transparent" />

      {/* 메뉴 — 세로로 세운다. 아이콘과 글자가 한 줄에 놓여 읽기 쉽다 */}
      <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {NAV_ITEMS.map((item) => {
          const active = item.id === tab;
          return (
            <li key={item.id}>
              <button
                onClick={() => onChange(item.id)}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex w-full items-center gap-3 rounded-lg px-3 py-3.5 text-left text-[17px] transition-colors",
                  active
                    ? "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] font-semibold text-[var(--accent)]"
                    : "text-gray-500 hover:bg-gray-500/10 dark:text-gray-400",
                ].join(" ")}
              >
                {/* 활성 메뉴는 왼쪽에 강조색 기둥이 선다 */}
                <span
                  className={[
                    "h-7 w-[3px] shrink-0 rounded-full",
                    active ? "bg-[var(--accent)]" : "bg-transparent",
                  ].join(" ")}
                />
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.1 : 1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {item.icon}
                </svg>
                <span className="truncate">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="px-4 py-3 text-[11px] leading-snug text-gray-400">
        개인 학습·연습용
      </p>
    </nav>
  );
}
