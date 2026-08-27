"use client";

import { useEffect, useState } from "react";

import { findSheets, type SheetHit } from "@/lib/api";

/**
 * 웹에 올라온 이 곡의 코드 악보 찾기.
 *
 * 악보를 여기 옮겨 그리지 않는다 — 남이 만든 악보를 복제하면 저작권에
 * 걸린다. 어디에 있는지 찾아 주고, 누르면 그 사이트에서 정식으로 본다.
 */
export function SheetFinder({ resultId, online }: { resultId: string; online: boolean }) {
  const [items, setItems] = useState<SheetHit[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    findSheets(resultId)
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setQuery(res.query);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [resultId, online]);

  if (!online) {
    return (
      <p className="py-4 text-center text-xs text-gray-500">
        악보를 찾으려면 분석 서버가 필요합니다.
        <br />
        옆의 「추천 사이트」에서 직접 찾아보세요.
      </p>
    );
  }

  if (error) {
    return <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>;
  }

  if (items === null) {
    return <p className="py-4 text-center text-xs text-gray-400">악보 찾는 중…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-gray-500">
        찾지 못했습니다. 「추천 사이트」에서 직접 찾아보세요.
      </p>
    );
  }

  return (
    <>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        <span className="font-medium">{query}</span> 로 찾은 결과입니다. 누르면
        그 사이트에서 악보를 봅니다.
      </p>
      <ul className="space-y-1 pb-2">
        {items.map((hit) => (
          <li key={hit.url}>
            <a
              href={hit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded border border-gray-200 px-2.5 py-1.5 dark:border-gray-700"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{hit.title}</span>
                <span className="block text-[11px] text-gray-500">{hit.site}</span>
              </span>
              <span className="shrink-0 text-gray-400">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
