"use client";

import { useSyncExternalStore } from "react";

/** 값이 바뀌지 않는 브라우저 능력치라 구독할 대상이 없다 */
const noSubscribe = () => () => {};

/**
 * 브라우저에서만 알 수 있는 값을 읽는다.
 *
 * 마운트 이펙트에서 setState로 읽으면 렌더가 한 번 더 돌고 서버 렌더와도 어긋난다.
 * `read`는 호출할 때마다 같은 값을 돌려주는 원시값이어야 한다.
 */
export function useClientValue<T>(read: () => T, serverFallback: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverFallback);
}
