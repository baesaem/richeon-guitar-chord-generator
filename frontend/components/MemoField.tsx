"use client";

import { useRef, useState } from "react";

import { Popup } from "@/components/Popup";
import { HEAD_LEFT, HEAD_RIGHT } from "@/lib/memoPaint";

/** 메모에 넣을 특수 기호 — 음표를 가리키는 화살표와 떨림(비브라토) 물결 */
const MARKS = ["↓", "↑", "~"];

/**
 * 메모 한 칸 — 글 칸, 특수 기호 단추, 추가·고치기·삭제.
 * 마디 위 메모(ChordPicker)와 제목줄 메모(HeadMemoPicker)가 함께 쓴다.
 */
export function MemoField({
  label,
  memo,
  onMemo,
  onDone,
  placeholder = "예) 여기서 빠르게 / 2절은 쉼 / 하이코드",
}: {
  label: string;
  memo?: string;
  /** 메모를 적거나(글) 지운다(null) */
  onMemo: (text: string | null) => void;
  /** 적거나 지운 뒤에 부른다(창 닫기) */
  onDone?: () => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(memo ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  /** 누른 기호를 글자 커서 자리에 넣는다(폰 자판에서 찾기 어려운 ↓ ↑ ~) */
  const insertMark = (mark: string) => {
    const el = ref.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? a;
    setText((text.slice(0, a) + mark + text.slice(b)).slice(0, 200));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + mark.length, a + mark.length);
    });
  };

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-black">
      <div className="mb-1 flex items-center gap-1">
        <span className="mr-auto text-[11px] font-semibold text-amber-800">
          {label}
        </span>
        {MARKS.map((mark) => (
          <button
            key={mark}
            type="button"
            title={`${mark} 넣기`}
            // 눌러도 글자 칸의 커서 자리를 잃지 않게
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertMark(mark)}
            className="h-7 w-9 rounded border border-amber-300 bg-white text-base font-bold leading-none text-amber-900 active:bg-amber-100"
          >
            {mark}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={200}
        placeholder={placeholder}
        className="w-full resize-none rounded border border-amber-200 bg-white px-2 py-1 text-sm"
      />
      <div className="mt-1 flex gap-1">
        <button
          className="flex-1 rounded bg-amber-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          disabled={!text.trim() || text.trimEnd() === (memo ?? "")}
          onClick={() => {
            onMemo(text);
            onDone?.();
          }}
        >
          {memo ? "메모 고치기" : "메모 추가"}
        </button>
        {memo && (
          <button
            className="flex-1 rounded bg-white py-2 text-sm text-red-600 ring-1 ring-red-200"
            onClick={() => {
              onMemo(null);
              onDone?.();
            }}
          >
            메모 삭제
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 악보 제목줄 메모 — 제목 왼쪽·오른쪽(강사님: 「상단 제목줄에도 왼쪽 오른쪽
 * 메모」). 제목줄을 오른쪽 클릭(길게 누르기)하면 열린다.
 */
export function HeadMemoPicker({
  left,
  right,
  onMemo,
  onClose,
}: {
  left?: string;
  right?: string;
  onMemo: (key: typeof HEAD_LEFT | typeof HEAD_RIGHT, text: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Popup title="제목줄 메모" onClose={onClose}>
      <MemoField
        label="제목 왼쪽 메모"
        memo={left}
        onMemo={(t) => onMemo(HEAD_LEFT, t)}
        onDone={onClose}
        placeholder="예) 카포 2 / 스트로크"
      />
      <MemoField
        label="제목 오른쪽 메모"
        memo={right}
        onMemo={(t) => onMemo(HEAD_RIGHT, t)}
        onDone={onClose}
        placeholder="예) ♩=83 / 원키 G"
      />
    </Popup>
  );
}
