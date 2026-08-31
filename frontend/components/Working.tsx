"use client";

/**
 * 작업 중 표시.
 *
 * 화면 한가운데. 몇 초씩 걸리는 일에는 버튼 글자만 바꿔서는 부족하다 —
 * 눌렀는지 아닌지 몰라 또 누르게 된다.
 *
 * 멈출 수 있는 일(여러 곡 내보내기)에는 onCancel을 준다 — 이 창이
 * 화면을 다 덮으므로, 멈출 길이 없으면 오래 걸릴 때 앱이 죽은 것과
 * 같아진다. 실제로 「앱이 멈췄다」는 말이 그것이었다.
 */
export function Working({
  label,
  note,
  progress,
  onCancel,
}: {
  label: string;
  /** 지금 무엇을 하는 중인지 한 줄 */
  note?: string;
  /** 0~1. 알 수 없으면 넘기지 않는다 */
  progress?: number;
  /** 있으면 「멈추기」 단추가 붙는다 */
  onCancel?: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-[220px] rounded-2xl border border-[var(--panel-line)] bg-[var(--background)] p-5 text-center text-[var(--foreground)] shadow-xl">
        <span
          className="mx-auto mb-3 block h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--accent)] border-t-transparent"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="mt-0.5 truncate text-[11px] text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">{note}</p>}
        {progress !== undefined && (
          <>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--chip)]">
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
        {onCancel && (
          <button
            className="mt-3 w-full rounded-lg bg-[var(--panel)] py-2 text-xs font-medium text-[var(--foreground)]"
            onClick={onCancel}
          >
            멈추기
          </button>
        )}
      </div>
    </div>
  );
}
