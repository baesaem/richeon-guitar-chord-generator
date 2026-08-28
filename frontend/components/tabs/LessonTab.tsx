"use client";

import { useState } from "react";

import { Copyright } from "@/components/Copyright";
import { LinkShelf } from "@/components/LinkShelf";

/**
 * 레슨 — 밖에서 보며 배우는 것들.
 *
 * 강의실은 기타반이 함께 보는 자료, 내 강좌는 각자 따로 듣는 것.
 * 둘 다 링크를 담아 두고 눌러서 그 자리로 가는 방식이다 — 영상을 앱
 * 안에 붙들어 두지 않는다. YouTube가 중심이지만 밴드·블로그·카페처럼
 * 영상이 아닌 자료도 담긴다.
 */
export function LessonTab() {
  const [page, setPage] = useState<"classroom" | "mine">("classroom");

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <h2 className="mb-2 text-lg font-bold roomy:hidden">레슨</h2>

      <div className="mb-3 flex gap-1">
        {(
          [
            ["classroom", "강의실"],
            ["mine", "내 강좌"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setPage(value)}
            className={[
              "flex-1 whitespace-nowrap rounded px-2 py-2 text-[13px]",
              page === value
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-gray-100 dark:bg-gray-800",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {page === "classroom" ? (
        <LinkShelf
          shelf="classroom"
          addLabel="+ 강의실 링크 추가"
          blurb="기타반이 함께 보는 강좌와 자료입니다. 선생님이 알려 준 YouTube 강좌, 밴드 공지, 블로그 글 주소를 담아 두세요."
        />
      ) : (
        <LinkShelf
          shelf="mine"
          addLabel="+ 내 강좌 추가"
          blurb="따로 듣고 있는 강좌를 담아 두는 곳입니다. 이 기기에만 저장되고, 누르면 그 자리로 열립니다."
        />
      )}

      <Copyright />
    </div>
  );
}
