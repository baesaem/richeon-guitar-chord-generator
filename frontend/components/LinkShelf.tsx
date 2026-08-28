"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

import { AskConfirm } from "@/components/Ask";
import { Popup } from "@/components/Popup";
import { Working } from "@/components/Working";
import {
  addLecture,
  fetchTitle,
  listLectures,
  removeLecture,
  siteOf,
  thumbOf,
  videoIdOf,
  type Lecture,
  type Shelf,
} from "@/lib/lectures";
import { openLink } from "@/lib/openLink";

/**
 * 링크로 배우는 칸 — 강의실과 내 강좌가 같은 모습을 쓴다.
 *
 * YouTube 주소를 넣으면 제목과 섬네일을 앱이 알아서 가져온다. 밴드·
 * 블로그·카페처럼 영상이 아닌 자료도 담을 수 있다 — 그때는 사이트
 * 이름이 섬네일 자리를 대신한다(남의 사이트 제목은 브라우저가 읽지
 * 못하므로 제목은 직접 적거나 사이트 이름으로 남는다).
 */
export function LinkShelf({
  shelf,
  blurb,
  addLabel = "+ 링크 추가",
  canAdd = true,
}: {
  shelf: Shelf;
  /** 이 칸이 무엇인지 한 줄 설명 */
  blurb: string;
  addLabel?: string;
  /** 링크를 담을 수 있는가. 강의실은 선생님만 담는다 */
  canAdd?: boolean;
}) {
  const [items, setItems] = useState<Lecture[]>(() =>
    typeof window === "undefined" ? [] : listLectures(shelf),
  );
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Lecture | null>(null);

  const submit = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("주소를 http:// 또는 https:// 로 시작하게 붙여넣어 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    const videoId = videoIdOf(trimmed) ?? undefined;
    const site = siteOf(trimmed);
    // 제목을 적지 않았으면 영상에서 알아본다. 영상이 아니면 사이트 이름.
    const auto = title.trim() || (await fetchTitle(trimmed)) || site;
    setItems(addLecture(shelf, { id: videoId ?? trimmed, url: trimmed, title: auto, videoId, site }));
    setBusy(false);
    setAdding(false);
    setUrl("");
    setTitle("");
  };

  return (
    <div>
      {busy && <Working label="링크 담는 중" note="영상이면 제목을 알아봅니다" />}

      <p className="mb-2 text-[11px] leading-snug text-gray-500">{blurb}</p>

      {canAdd && (
        <button
          className="mb-2.5 w-full rounded bg-gray-100 py-2.5 text-sm font-medium dark:bg-gray-800"
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
        >
          {addLabel}
        </button>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">
          {canAdd
            ? "아직 담은 링크가 없습니다. YouTube 강좌나 밴드·블로그 주소를 붙여넣어 보세요."
            : "아직 받은 자료가 없습니다. 위 「새 강좌 가져오기」를 눌러 보세요."}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2.5 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                onClick={() => openLink(l.url)}
              >
                {l.videoId ? (
                  <img
                    src={thumbOf(l.videoId)}
                    alt=""
                    className="h-12 w-20 shrink-0 rounded bg-gray-200 object-cover dark:bg-gray-800"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1 text-center text-[11px] font-semibold leading-tight text-[var(--accent)]">
                    {l.site}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block overflow-hidden text-[13px] leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                    {l.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-gray-400">
                    {l.site}
                  </span>
                </span>
              </button>
              {canAdd && (
                <button
                  className="shrink-0 px-1 text-xs text-red-500"
                  onClick={() => setConfirmDel(l)}
                  aria-label="링크 삭제"
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Popup title="링크 추가" width="max-w-xs" onClose={() => setAdding(false)}>
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            YouTube 강좌·밴드·블로그 등 주소를 붙여넣으세요. YouTube 영상은
            제목을 비워 두면 알아서 가져옵니다.
          </p>
          <input
            className="mb-1.5 w-full rounded border px-3 py-2.5 text-sm"
            placeholder="https://..."
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="w-full rounded border px-3 py-2.5 text-sm"
            placeholder="제목 (YouTube는 비워 두면 자동)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) submit();
            }}
          />
          {error && (
            <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {error}
            </p>
          )}
          <button
            className="mt-2.5 w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white disabled:opacity-40"
            disabled={!url.trim() || busy}
            onClick={submit}
          >
            담기
          </button>
        </Popup>
      )}

      {confirmDel && (
        <AskConfirm
          title="링크 삭제"
          message={`「${confirmDel.title}」를 목록에서 뺍니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => setItems(removeLecture(shelf, confirmDel.id))}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
