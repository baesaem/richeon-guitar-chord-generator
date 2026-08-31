"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";

import { AskConfirm } from "@/components/Ask";
import { Popup } from "@/components/Popup";
import { Working } from "@/components/Working";
import {
  addLecture,
  fetchTitle,
  listLectures,
  removeLecture,
  siteOf,
  updateLecture,
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
  merged,
  onSelected,
}: {
  shelf: Shelf;
  /** 이 칸이 무엇인지 한 줄 설명 */
  blurb: string;
  addLabel?: string;
  /** 링크를 담을 수 있는가. 강의실은 강사님만 담는다 */
  canAdd?: boolean;
  /**
   * 여러 칸을 한 목록으로 합쳐 본다(초·중급 모두 보기). 주면 읽기만
   * 하는 화면이 된다 — 어느 반 것인지 딱지를 달아 구분한다.
   */
  merged?: { shelf: Shelf; label: string }[];
  /** 골라 둔 자료가 바뀔 때. 강사님이 고른 것만 올리는 데 쓴다 */
  onSelected?: (ids: string[]) => void;
}) {
  const readOnly = !!merged || !canAdd;
  const [items, setItems] = useState<Lecture[]>(() => {
    if (typeof window === "undefined") return [];
    if (!merged) return listLectures(shelf);
    // 합쳐 보기: 반 딱지를 달아 이어 붙인다
    return merged.flatMap((m) =>
      listLectures(m.shelf).map((l) => ({ ...l, id: `${m.shelf}:${l.id}`, klass: m.label })),
    ) as Lecture[];
  });
  // 고른 자료(관리자). 고른 것만 올리거나 지운다
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // 부모에게 알리는 일은 그리기가 끝난 뒤에 한다
  const notify = useRef(onSelected);
  notify.current = onSelected;
  useEffect(() => {
    notify.current?.([...picked]);
  }, [picked]);
  const [adding, setAdding] = useState(false);
  // 고치는 중인 자료(없으면 새로 담는 중이다)
  const [editing, setEditing] = useState<Lecture | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Lecture | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);

  /** 담기·고치기 창을 연다. 고치기면 지금 값으로 채워 둔다 */
  const openDialog = (item?: Lecture) => {
    setError(null);
    setEditing(item ?? null);
    setUrl(item?.url ?? "");
    setTitle(item ? item.title : "");
    setNote(item?.note ?? "");
    setAdding(true);
  };

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
    const next: Lecture = {
      id: videoId ?? trimmed,
      url: trimmed,
      title: auto,
      videoId,
      site,
      note: note.trim() || undefined,
    };
    // 고치는 중이면 자리를 지킨 채 갈아 끼운다
    setItems(
      editing ? updateLecture(shelf, editing.id, next) : addLecture(shelf, next),
    );
    setBusy(false);
    setAdding(false);
    setEditing(null);
    setUrl("");
    setTitle("");
    setNote("");
  };

  return (
    <div>
      {busy && <Working label="링크 담는 중" note="영상이면 제목을 알아봅니다" />}

      <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">{blurb}</p>

      {!readOnly && (
        <button
          className="mb-2 w-full rounded bg-[var(--panel)] py-1.5 text-xs font-medium"
          onClick={() => openDialog()}
        >
          {addLabel}
        </button>
      )}

      {!readOnly && picked.size > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2 py-1.5 text-[11px]">
          <span className="font-medium text-[var(--accent)]">
            {picked.size}개 골랐습니다
          </span>
          <button
            className="ml-auto underline"
            onClick={() => setPicked(new Set())}
          >
            고르기 해제
          </button>
          <button
            className="text-red-500 underline"
            onClick={() => setConfirmBulk(true)}
          >
            고른 것 삭제
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
          {readOnly
            ? "아직 받은 자료가 없습니다. 위 「새 강좌 가져오기」를 눌러 보세요."
            : "아직 담은 링크가 없습니다. YouTube 강좌나 밴드·블로그 주소를 붙여넣어 보세요."}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--panel-line)] p-2"
            >
              {!readOnly && (
                <input
                  type="checkbox"
                  className="ml-0.5 shrink-0"
                  checked={picked.has(l.id)}
                  onChange={() => togglePick(l.id)}
                  aria-label="이 자료 고르기"
                />
              )}
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                onClick={() => openLink(l.url)}
              >
                {l.videoId ? (
                  <img
                    src={thumbOf(l.videoId)}
                    alt=""
                    className="h-12 w-20 shrink-0 rounded bg-[var(--chip)] object-cover"
                    loading="lazy"
                    /* 지워졌거나 비공개가 된 영상은 그림이 없다.
                       깨진 그림 대신 빈 칸으로 둔다 */
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
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
                  {l.note && (
                    <span className="mt-0.5 block overflow-hidden text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                      {l.note}
                    </span>
                  )}
                  <span className="mt-0.5 block truncate text-[10px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
                    {(l as Lecture & { klass?: string }).klass
                      ? `${(l as Lecture & { klass?: string }).klass} · ${l.site}`
                      : l.site}
                  </span>
                </span>
              </button>
              {!readOnly && (
                <>
                  <button
                    className="shrink-0 px-1 text-xs text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]"
                    onClick={() => openDialog(l)}
                    aria-label="링크 수정"
                  >
                    수정
                  </button>
                  <button
                    className="shrink-0 px-1 text-xs text-red-500"
                    onClick={() => setConfirmDel(l)}
                    aria-label="링크 삭제"
                  >
                    삭제
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Popup
          title={editing ? "링크 수정" : "링크 추가"}
          width="max-w-xs"
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <p className="mb-2 text-[11px] leading-snug text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
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
            className="mb-1.5 w-full rounded border px-3 py-2.5 text-sm"
            placeholder="제목 (YouTube는 비워 두면 자동)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {/* 안내글 — 제목만으로는 왜 보라는 것인지 알 수 없다 */}
          <textarea
            className="h-16 w-full rounded border px-3 py-2 text-sm"
            placeholder="설명 (예: 3번 패턴 연습에 좋습니다)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
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
            {editing ? "고치기" : "담기"}
          </button>
        </Popup>
      )}

      {confirmBulk && (
        <AskConfirm
          title="고른 자료 삭제"
          message={`고른 ${picked.size}개를 목록에서 뺍니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => {
            let left = items;
            for (const id of picked) left = removeLecture(shelf, id);
            setItems(left);
            setPicked(new Set());
          }}
          onClose={() => setConfirmBulk(false)}
        />
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
