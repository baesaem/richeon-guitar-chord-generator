"use client";

import { useState } from "react";

/**
 * ♩ 한 박의 빠르기를 손으로 정한다.
 *
 * 박은 음원에서 재지만, 곡 끝이 페이드로 잦아들거나 앞뒤에 말소리가
 * 붙으면 마디를 짧게 잡아 커서가 갈수록 앞선다 — 그럴 때는 귀로 잰
 * ♩값이 낫다. 악보를 고치는 자리라면 어떤 악보든 이 손잡이가 있어야
 * 한다. 그림 악보에만 없어서, 커서가 밀려도 손댈 데가 없었다.
 *
 * 소수 한 자리까지 받는다. 67과 68 사이는 1.5%라 3분이면 2.7초가
 * 벌어진다 — 정수로는 커서를 끝까지 맞출 수 없는 곡이 있다.
 */
export function BeatBpm({
  bpm = 0,
  onSet,
}: {
  /** 음원에서 잰 빠르기. 칸에 처음 적히는 값이다 */
  bpm?: number;
  onSet?: (bpm: number) => void | Promise<void>;
}) {
  // 서버가 박을 다시 까는 동안(음원 끝을 재느라 1~2초) 눌렀는지 알 수
  // 있게 한다. 아무 표시가 없으면 거듭 누르게 된다
  const [busy, setBusy] = useState(false);
  if (!onSet) return null;
  const value = bpm ? Math.round(bpm * 10) / 10 : 70;
  const apply = (v: number) => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve(onSet(v)).finally(() => setBusy(false));
  };
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span>♩</span>
      <input
        /* 곡의 빠르기가 바뀌면(맞추기로 다시 깔았거나 곡을 바꿨을 때) 칸을 새로
           채운다 — 처음 값만 적어 두었더니 옛 숫자가 남아, 맞추기를 누르면 그
           옛 숫자로 다시 깔거나 다른 곡의 빠르기를 쓸 수 있었다 */
        key={value}
        type="number"
        step={0.1}
        className="w-14 rounded border border-[var(--panel-line)] bg-[var(--background)] px-1 py-0.5 text-right"
        defaultValue={value}
        min={20}
        max={400}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(+(e.target as HTMLInputElement).value);
        }}
        title="이 빠르기로 박을 다시 깝니다(소수 한 자리까지). 커서가 갈수록 앞서면 조금 낮추고, 처지면 높이세요"
      />
      <button
        className="rounded bg-[var(--chip)] px-1.5 py-0.5 font-semibold disabled:opacity-60"
        disabled={busy}
        onClick={(e) => {
          const input = e.currentTarget
            .previousElementSibling as HTMLInputElement;
          apply(+input.value);
        }}
      >
        {busy ? "맞추는 중…" : "맞추기"}
      </button>
    </span>
  );
}
