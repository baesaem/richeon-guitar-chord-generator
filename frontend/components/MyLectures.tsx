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
  thumbOf,
  videoIdOf,
  type Lecture,
} from "@/lib/lectures";
import { openLink } from "@/lib/openLink";

/**
 * 내 강좌 — 수강자가 개인적으로 듣는 YouTube 강좌 링크 모음.
 *
 * 주소를 붙여넣으면 제목은 앱이 알아서 알아본다(YouTube oEmbed).
 * 못 알아볼 때만 적은 제목·주소를 쓴다. 누르면 YouTube로 열린다.
 */
export function MyLectures() {
  const [items, setItems] = useState<Lecture[]>(() =>
    typeof window === "undefined" ? [] : listLectures(),
  );
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Lecture | null>(null);

  const submit = async () => {
    const trimmed = url.trim();
    const id = videoIdOf(trimmed);
    if (!id) {
      setError("YouTube 영상 주소가 아닙니다. 영상 링크를 붙여넣어 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    // 제목을 적지 않았으면 영상에서 알아본다
    const auto = title.trim() || (await fetchTitle(trimmed)) || trimmed;
    setItems(addLecture({ id, url: trimmed, title: auto }));
    setBusy(false);
    setAdding(false);
    setUrl("");
    setTitle("");
  };

  return (
    <div>
      {busy && <Working label="강좌 담는 중" note="영상 제목을 알아봅니다" />}

      <p className="mb-2 text-[11px] leading-snug text-gray-500">
        따로 보고 있는 YouTube 기타 강좌를 담아 두는 곳입니다. 이 기기에만
        저장되고, 누르면 영상이 열립니다.
      </p>

      <button
        className="mb-2.5 w-full rounded bg-[var(--accent)] py-2.5 text-sm font-medium text-white"
        onClick={() => {
          setError(null);
          setAdding(true);
        }}
      >
        + 강좌 추가
      </button>

      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400">
          아직 담은 강좌가 없습니다. YouTube 강좌 링크를 붙여넣어 보세요.
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
                <img
                  src={thumbOf(l.id)}
                  alt=""
                  className="h-12 w-20 shrink-0 rounded object-cover bg-gray-200 dark:bg-gray-800"
                  loading="lazy"
                />
                <span className="min-w-0 flex-1 text-[13px] leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                  {l.title}
                </span>
              </button>
              <button
                className="shrink-0 px-1 text-xs text-red-500"
                onClick={() => setConfirmDel(l)}
                aria-label="강좌 삭제"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Popup title="강좌 추가" width="max-w-xs" onClose={() => setAdding(false)}>
          <p className="mb-2 text-[11px] leading-snug text-gray-500">
            YouTube 강좌 주소를 붙여넣으세요. 제목은 비워 두면 영상에서
            알아서 가져옵니다.
          </p>
          <input
            className="mb-1.5 w-full rounded border px-3 py-2.5 text-sm"
            placeholder="https://youtube.com/..."
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            className="w-full rounded border px-3 py-2.5 text-sm"
            placeholder="제목 (비워 두면 자동)"
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
          title="강좌 삭제"
          message={`「${confirmDel.title}」를 목록에서 뺍니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => setItems(removeLecture(confirmDel.id))}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
