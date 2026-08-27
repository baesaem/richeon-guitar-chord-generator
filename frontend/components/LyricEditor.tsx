"use client";

import { useState } from "react";

import { AskConfirm } from "@/components/Ask";
import { Popup } from "@/components/Popup";
import { EDIT_HOLD_MS } from "@/lib/editChords";
import { useLongPress } from "@/lib/useLongPress";

/**
 * 가사 한 줄 고치기.
 *
 * 자동 자막에서 온 가사는 글자가 자주 틀리고, 시각이 어림인 가사는
 * 넘어가는 시점이 어긋난다. 한 줄씩 손보면 쓸 만해진다.
 *
 * 시각도 함께 고칠 수 있게 둔다 — 글자만 맞고 시점이 틀리면 따라 부를
 * 수 없다. 지금 듣고 있는 자리를 그대로 넣는 단추를 붙여, 노래를 들으며
 * 맞출 수 있게 한다.
 */
export function LyricEditor({
  index,
  text,
  at,
  now,
  onSave,
  onDelete,
  onClose,
}: {
  index: number;
  text: string;
  at: number;
  /** 지금 재생 중인 시각. 「여기서 시작」에 쓴다 */
  now: number;
  onSave: (text: string, at: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [start, setStart] = useState(at);

  const clock = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <Popup title={`${index + 1}번째 줄`} onClose={onClose}>
      <textarea
        className="w-full rounded border px-3 py-2 text-sm"
        rows={2}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-gray-500">시작</span>
        <span className="tabular-nums text-sm font-medium">{clock(start)}</span>
        <button
          className="ml-auto rounded bg-gray-100 px-2 py-1 text-[11px] dark:bg-gray-800"
          onClick={() => setStart(now)}
        >
          지금 자리({clock(now)})로
        </button>
      </div>

      <button
        className="mt-3 w-full rounded bg-[var(--accent)] py-3 text-sm font-medium text-white disabled:opacity-40"
        disabled={!draft.trim()}
        onClick={() => {
          onSave(draft.trim(), start);
          onClose();
        }}
      >
        고치기
      </button>
      <button
        className="mt-1.5 w-full rounded py-2.5 text-sm text-red-600"
        onClick={() => setConfirmDelete(true)}
      >
        이 줄 지우기
      </button>
      {confirmDelete && (
        <AskConfirm
          title="가사 줄 지우기"
          message="이 가사 줄을 지웁니다."
          confirmLabel="지우기"
          danger
          onConfirm={() => {
            onDelete();
            onClose();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Popup>
  );
}


/**
 * 가사 한 줄.
 *
 * 짧게 누르면 그 자리로 건너뛰고, 길게 누르면 고친다. 코드 마디와 같은
 * 방식이라 한 번 익히면 어디서든 통한다.
 */
export function LyricRow({
  text,
  label,
  now,
  onSeek,
  onEdit,
}: {
  text: string;
  /** 왼쪽에 붙일 표시(마디 번호 등) */
  label?: string;
  now: boolean;
  onSeek: () => void;
  onEdit?: () => void;
}) {
  const press = useLongPress(() => onEdit?.(), EDIT_HOLD_MS);
  return (
    <div
      onClick={onSeek}
      {...(onEdit ? press.handlers : {})}
      className={[
        "relative cursor-pointer select-none py-0.5 transition-colors",
        now ? "font-bold text-[var(--accent)]" : "",
      ].join(" ")}
    >
      {press.progress > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 rounded bg-[var(--accent)] opacity-20"
          style={{ width: `${press.progress * 100}%` }}
        />
      )}
      <span className="relative flex gap-2">
        {label && (
          <span className="w-16 shrink-0 pt-0.5 text-[10px] tabular-nums text-gray-400">
            {label}
          </span>
        )}
        <span className="min-w-0 flex-1">{text}</span>
      </span>
    </div>
  );
}
