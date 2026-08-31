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
  selected,
  onShift,
  onGrab,
}: {
  text: string;
  /** 왼쪽에 붙일 표시(마디 번호 등) */
  label?: string;
  now: boolean;
  onSeek: () => void;
  onEdit?: () => void;
  /** 고른 줄인가. 고른 줄에만 마디 옮기기 단추가 붙는다 */
  selected?: boolean;
  /** 이 줄부터 뒤 가사를 한 마디 앞(-1)·뒤(+1)로 민다 */
  onShift?: (dir: 1 | -1) => void;
  /** 손잡이를 잡았다. 여기서부터 끌어 자리를 바꾼다 */
  onGrab?: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const press = useLongPress(() => onEdit?.(), EDIT_HOLD_MS);
  return (
    <div
      onClick={onSeek}
      {...(onEdit ? press.handlers : {})}
      className={[
        "relative cursor-pointer select-none rounded py-0.5 transition-colors",
        now ? "font-bold text-[var(--accent)]" : "",
        selected ? "bg-[var(--accent)]/10 px-1" : "",
      ].join(" ")}
    >
      {press.progress > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 rounded bg-[var(--accent)] opacity-20"
          style={{ width: `${press.progress * 100}%` }}
        />
      )}
      <span className="relative flex items-center gap-2">
        {label && (
          <span className="w-16 shrink-0 pt-0.5 text-[10px] tabular-nums text-gray-400">
            {label}
          </span>
        )}
        <span className="min-w-0 flex-1">{text}</span>
        {/* 고른 줄에만 붙는다 — 모든 줄에 두면 가사보다 단추가 많다.
            누르면 이 줄부터 뒤 가사가 함께 밀린다 */}
        {selected && (onShift || onGrab) && (
          <span className="flex shrink-0 items-center gap-1">
            {/* 잡고 끌면 글자가 다른 칸으로 옮겨 간다. 시각은 그 자리에
                그대로 있다 — 자막이 한 줄씩 밀려 붙었을 때 쓴다 */}
            {onGrab && (
              <button
                className="cursor-grab touch-none rounded bg-gray-200/80 px-1.5 py-0.5 text-[11px] text-gray-600 active:cursor-grabbing dark:bg-gray-700 dark:text-gray-300"
                title="잡고 끌어 가사 자리 바꾸기"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onGrab(e);
                }}
                onClick={(e) => e.stopPropagation()}
              >
                ≡
              </button>
            )}
            {onShift && (
              <>
                <button
                  className="rounded bg-gray-200/80 px-1.5 py-0.5 text-[11px] font-bold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  title="이 줄부터 한 마디 앞으로 — 가사가 노래보다 늦을 때"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShift(-1);
                  }}
                >
                  ◀
                </button>
                <button
                  className="rounded bg-gray-200/80 px-1.5 py-0.5 text-[11px] font-bold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  title="이 줄부터 한 마디 뒤로 — 가사가 노래보다 이를 때"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShift(1);
                  }}
                >
                  ▶
                </button>
              </>
            )}
          </span>
        )}
      </span>
    </div>
  );
}
