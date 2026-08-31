"use client";

/**
 * 악보 위에 놓는 두 가지 조절 — 싱크와 마디 수.
 *
 * 연주설정 안에 있어도 되지만, 둘 다 「악보를 보면서」 맞추는 것이다.
 * 창을 열었다 닫았다 하며 맞출 수는 없어 안내줄에 붙여 둔다.
 *
 * 코드악보·멜로디·파형이 같은 자리에서 같은 모양으로 쓴다 — 화면을
 * 옮길 때마다 단추를 새로 찾게 하지 않는다.
 */

/** 한 칸씩 옮기는 작은 단추. 악보가 밀려 내려가지 않게 작게 만든다 */
const STEP =
  "rounded bg-[var(--chip)] px-1 font-bold leading-4 text-[var(--foreground)] disabled:opacity-30 roomy:px-1.5 roomy:leading-5";

export function ViewSteppers({
  sync,
  onSync,
  bars,
  onBars,
  barsMax,
  barsLabel,
  onShiftBar,
}: {
  /** 코드 싱크(초). 화면이 노래보다 이르거나 늦을 때 맞춘다 */
  sync?: number;
  onSync?: (sec: number) => void;
  /** 한 번에 보는 마디 수. 0이면 줄 전체 */
  bars?: number;
  onBars?: (n: number) => void;
  barsMax?: number;
  /** 0일 때 적을 말. 없으면 0을 쓰지 않는다는 뜻 */
  barsLabel?: string;
  /**
   * 악보를 음원 위에서 한 마디씩 미는 손잡이(강사님).
   *
   * delta는 마디밀기(barOffset)에 더할 값이다. 커서는 그 반대로 움직인다
   * — +1이면 커서가 한 마디 왼쪽으로 간다. 단추의 화살표는 커서 쪽을
   * 가리키므로 여기서 부호가 뒤집혀 들어온다.
   *
   * 싱크와 나란히 있어야 한다 — 어긋난 것이 한 마디인지 반 박인지는
   * 눌러 보며 가리는 일이라, 두 손잡이가 떨어져 있으면 오가야 한다.
   */
  onShiftBar?: (delta: number) => void;
}) {
  const max = barsMax ?? 8;
  return (
    /* 둘을 한 상자에 묶는다 — 따로 두면 각각이 제 줄을 차지해 접힌다 */
    <span className="flex shrink-0 items-center gap-1 text-[10px] roomy:text-[12px]">
      {onSync && (
        <span className="flex items-center gap-px">
          <span className="text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">싱크</span>
          <button
            className={STEP}
            onClick={() => onSync(Math.round(((sync ?? 0) - 0.1) * 10) / 10)}
            title="화면을 늦춥니다 — 악보가 노래보다 이를 때"
          >
            －
          </button>
          <span className="w-6 text-center tabular-nums roomy:w-7">
            {(sync ?? 0) > 0 ? "+" : ""}
            {(sync ?? 0).toFixed(1)}
          </span>
          <button
            className={STEP}
            onClick={() => onSync(Math.round(((sync ?? 0) + 0.1) * 10) / 10)}
            title="화면을 당깁니다 — 악보가 노래보다 늦을 때"
          >
            ＋
          </button>
        </span>
      )}

      {/* 한 마디씩 앞뒤로. 음원과 어긋났을 때 강사님이 맞춘다.
          화살표는 「커서」가 갈 쪽을 가리킨다 — 속으로 세는 마디밀기는
          그 반대라서 부호를 뒤집어 넘긴다. */}
      {onShiftBar && (
        <span className="flex items-center gap-px">
          <span className="text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">마디</span>
          <button
            className={STEP}
            onClick={() => onShiftBar(1)}
            title="커서를 한 마디 왼쪽으로 — 커서가 노래보다 이르게 갈 때"
          >
            ◀
          </button>
          <button
            className={STEP}
            onClick={() => onShiftBar(-1)}
            title="커서를 한 마디 오른쪽으로 — 커서가 노래보다 늦게 갈 때"
          >
            ▶
          </button>
        </span>
      )}

      {/* 마디를 줄이면 그만큼 커진다. 그래도 단추의 ＋－는 적힌 숫자를
          따른다 — 크기를 따르면 ＋를 눌렀는데 숫자가 줄어 헷갈린다. */}
      {onBars && (
        <span className="flex items-center gap-px">
          <button
            className={STEP}
            disabled={bars === 1}
            onClick={() => onBars(bars === 0 ? max : Math.max((bars ?? 1) - 1, 1))}
            title="마디를 줄입니다 — 그만큼 크게 보입니다"
          >
            －
          </button>
          <span className="w-9 text-center tabular-nums roomy:w-11">
            {bars ? `${bars}마디` : barsLabel ?? "줄 전체"}
          </span>
          <button
            className={STEP}
            disabled={!barsLabel && bars === max}
            onClick={() =>
              onBars((bars ?? 1) >= max ? (barsLabel ? 0 : max) : (bars ?? 1) + 1)
            }
            title="마디를 늘립니다 — 그만큼 작게 보입니다"
          >
            ＋
          </button>
        </span>
      )}
    </span>
  );
}
