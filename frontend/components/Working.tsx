"use client";

/**
 * 작업 중 표시.
 *
 * 화면 한가운데. 몇 초씩 걸리는 일에는 버튼 글자만 바꿔서는 부족하다 —
 * 눌렀는지 아닌지 몰라 또 누르게 된다.
 *
 * 닫는 버튼은 없다. 중간에 멈출 수 없는 일에 쓰고, 끝나면 저절로 사라진다.
 */
export function Working({
  label,
  note,
  progress,
}: {
  label: string;
  /** 지금 무엇을 하는 중인지 한 줄 */
  note?: string;
  /** 0~1. 알 수 없으면 넘기지 않는다 */
  progress?: number;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-[220px] rounded-2xl bg-white p-5 text-center shadow-xl dark:bg-gray-900">
        <span
          className="mx-auto mb-3 block h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--accent)] border-t-transparent"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="mt-0.5 truncate text-[11px] text-gray-500">{note}</p>}
        {progress !== undefined && (
          <>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] tabular-nums text-[var(--accent)]">
              {Math.round(progress * 100)}%
            </p>
          </>
        )}
      </div>
    </div>
  );
}
