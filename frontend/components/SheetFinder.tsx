"use client";

import { useEffect, useState } from "react";

import { findSheets, type SheetHit } from "@/lib/api";
import { hasLocalLlm, songInfo } from "@/lib/llmClient";
import { SHEET_SOURCES, sheetQuery } from "@/lib/sheetSearch";

/**
 * 웹에 올라온 이 곡의 코드 악보 찾기.
 *
 * 악보를 여기 옮겨 그리지 않는다 — 남이 만든 악보를 복제하면 저작권에
 * 걸린다. 어디에 있는지 찾아 주고, 누르면 그 사이트에서 정식으로 본다.
 *
 * 서버가 없으면 페이지 목록까지는 못 만든다. 검색 사이트들이 브라우저에서
 * 오는 요청을 막아 둬서(CORS) 결과를 읽을 수가 없다. 대신 AI로 검색어를
 * 다듬어 각 악보 사이트의 검색 화면으로 바로 보낸다.
 */
export function SheetFinder({
  resultId,
  title,
  online,
}: {
  resultId: string;
  title: string;
  online: boolean;
}) {
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

  if (!online) return <OfflineSheets title={title} />;

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

/**
 * 서버 없이 악보 찾기.
 *
 * AI 키가 있으면 영상 제목에서 가수·곡명을 가려내 검색어로 쓴다. 없으면
 * 제목에서 홍보 문구만 걷어낸 것을 쓴다. 어느 쪽이든 링크는 열린다.
 */
function OfflineSheets({ title }: { title: string }) {
  const [query, setQuery] = useState(() => sheetQuery(title));
  const [refined, setRefined] = useState(false);
  const [busy, setBusy] = useState(hasLocalLlm());

  useEffect(() => {
    if (!hasLocalLlm()) return;
    let alive = true;
    songInfo(title)
      .then((info) => {
        if (!alive) return;
        const name = info ? [info.artist, info.title].filter(Boolean).join(" ") : "";
        if (name) {
          setQuery(name);
          setRefined(true);
        }
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [title]);

  return (
    <>
      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        검색어 <span className="font-medium">{query}</span>
        {busy && " · AI로 다듬는 중…"}
        {refined && " · AI가 다듬었습니다"}
        <br />
        서버가 없어 결과 목록까지는 못 만듭니다. 아래를 누르면 그 사이트에서
        이 검색어로 바로 찾습니다.
      </p>
      <ul className="space-y-1 pb-2">
        {SHEET_SOURCES.map((src) => (
          <li key={src.name}>
            <a
              href={src.url(query)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded border border-gray-200 px-2.5 py-1.5 dark:border-gray-700"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{src.name}</span>
                <span className="block text-[11px] leading-snug text-gray-500">
                  {src.note}
                </span>
              </span>
              <span className="shrink-0 text-gray-400">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
