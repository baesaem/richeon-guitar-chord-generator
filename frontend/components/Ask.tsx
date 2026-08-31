"use client";

import { useState } from "react";

import { Popup } from "@/components/Popup";

/**
 * 앱 안에서 묻는 창.
 *
 * 브라우저의 prompt()·confirm()을 쓰지 않는다. 실측: 이 앱을 여는 환경에서
 * prompt()가 "prompt() is not supported."를 던져 「+ 새 폴더」가 통째로
 * 죽었다. 폰의 웹앱·인앱 브라우저에서 흔한 일이라, 시스템 창에 기대지
 * 않고 우리가 그린다. 화면 안에 있으니 테마도 따라간다.
 */

export function AskText({
  title,
  placeholder = "",
  initial = "",
  confirmLabel = "만들기",
  onSubmit,
  onClose,
}: {
  title: string;
  placeholder?: string;
  /** 미리 채워 둘 값. 이름 바꾸기처럼 고칠 원본이 있을 때 쓴다 */
  initial?: string;
  confirmLabel?: string;
  /** 빈 값은 넘어오지 않는다 */
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    onClose();
  };

  return (
    <Popup title={title} onClose={onClose} width="max-w-xs" layer="z-[60]">
      <input
        className="w-full rounded border px-3 py-3 text-base"
        placeholder={placeholder}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button
        className="mt-3 w-full rounded bg-black py-3 text-white disabled:opacity-40 dark:bg-white dark:text-black"
        disabled={!value.trim()}
        onClick={submit}
      >
        {confirmLabel}
      </button>
    </Popup>
  );
}

export function AskConfirm({
  title,
  message,
  confirmLabel = "확인",
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  /** 되돌릴 수 없는 일이면 붉게 */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Popup title={title} onClose={onClose} width="max-w-xs" layer="z-[60]">
      <p className="text-sm leading-snug text-[var(--foreground)]">{message}</p>
      <div className="mt-3 flex gap-2">
        <button
          className="flex-1 rounded bg-[var(--panel)] py-3 text-sm"
          onClick={onClose}
        >
          취소
        </button>
        <button
          className={[
            "flex-1 rounded py-3 text-sm text-white",
            danger ? "bg-red-600" : "bg-black dark:bg-white dark:text-black",
          ].join(" ")}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Popup>
  );
}
