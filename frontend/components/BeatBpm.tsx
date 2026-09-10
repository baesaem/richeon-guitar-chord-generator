"use client";

/**
 * ♩ 한 박의 빠르기를 손으로 정한다.
 *
 * 박은 음원에서 재지만, 곡 끝이 페이드로 잦아들거나 앞뒤에 말소리가
 * 붙으면 마디를 짧게 잡아 커서가 갈수록 앞선다 — 그럴 때는 귀로 잰
 * ♩값이 낫다. 악보를 고치는 자리라면 어떤 악보든 이 손잡이가 있어야
 * 한다. 그림 악보에만 없어서, 커서가 밀려도 손댈 데가 없었다.
 */
export function BeatBpm({
  bpm = 0,
  onSet,
}: {
  /** 음원에서 잰 빠르기. 칸에 처음 적히는 값이다 */
  bpm?: number;
  onSet?: (bpm: number) => void;
}) {
  if (!onSet) return null;
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <span>♩</span>
      <input
        type="number"
        className="w-12 rounded border border-[var(--panel-line)] bg-[var(--background)] px-1 py-0.5 text-right"
        defaultValue={bpm ? Math.round(bpm) : 70}
        min={20}
        max={400}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSet(+(e.target as HTMLInputElement).value);
        }}
        title="이 빠르기로 박을 다시 깝니다. 커서가 갈수록 앞서면 조금 낮추고, 처지면 높이세요"
      />
      <button
        className="rounded bg-[var(--chip)] px-1.5 py-0.5 font-semibold"
        onClick={(e) => {
          const input = e.currentTarget
            .previousElementSibling as HTMLInputElement;
          onSet(+input.value);
        }}
      >
        맞추기
      </button>
    </span>
  );
}
