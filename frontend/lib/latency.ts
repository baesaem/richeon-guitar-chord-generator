"use client";

/**
 * 기기 지연 재기.
 *
 * 화면과 소리가 어긋나는 가장 큰 이유는 **소리가 늦게 나오기** 때문이다.
 * 재생기는 "지금 12.3초"라고 말하는데, 그 소리가 실제로 귀에 닿는 것은
 * 조금 뒤다. 블루투스 스피커·이어폰은 0.1~0.3초씩 늦다.
 *
 * 브라우저가 이 값을 알려 준다 — AudioContext.outputLatency. 알려 주면
 * 그대로 쓴다. 사람이 손으로 맞출 이유가 없다.
 *
 * **인터넷 속도는 상관없다.** 느린 회선은 재생이 끊기게 만들 뿐,
 * 화면과 소리 사이를 벌리지 않는다. 재생기가 말하는 시각은 이미 받아
 * 놓은 소리의 위치라서, 회선이 느려도 그 관계는 그대로다. 그래서 회선
 * 속도로 보정하는 짓은 하지 않는다 — 숫자만 움직이고 아무것도 고치지
 * 못한다.
 *
 * 알려 주지 않는 브라우저(사파리)에서는 0이 나온다. 그때는 설정에서
 * 손으로 넣는다.
 */

/** 기기가 소리를 내보내는 데 걸리는 시간(초). 알 수 없으면 0. */
export async function measureOutputLatency(): Promise<number> {
  if (typeof window === "undefined") return 0;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return 0;

  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctor();
    // 멈춰 있는 동안에는 값이 0으로 나온다. 깨워서 읽는다.
    await ctx.resume().catch(() => {});
    // outputLatency가 진짜 출력 지연이고, baseLatency는 그중 앞단만이다.
    // 값을 주지 않는 브라우저에서는 baseLatency라도 쓴다.
    const out = ctx.outputLatency || 0;
    const base = ctx.baseLatency || 0;
    const latency = out > 0 ? out : base;
    // 1초를 넘는 값은 잘못 읽은 것이다. 그런 기기는 없다.
    return latency > 0 && latency < 1 ? Math.round(latency * 100) / 100 : 0;
  } catch {
    return 0;
  } finally {
    ctx?.close().catch(() => {});
  }
}
