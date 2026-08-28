"use client";

import { driveConnect, driveConnectWait, driveStatus } from "./api";
import { openLink } from "./openLink";

/**
 * 드라이브에 올릴 준비를 시킨다.
 *
 * 이미 연결돼 있으면 곧바로 돌아오고, 아니면 구글 동의 화면을 열어
 * 끝날 때까지 기다린다. 동의는 이 PC에서 한 번만 — 갱신 토큰이 서버에
 * 남아 다음부터는 이 함수가 그냥 통과한다.
 *
 * onStep으로 지금 무엇을 하는지 알려 준다(화면의 진행 표시에 쓴다).
 */
export async function ensureDriveReady(
  onStep?: (label: string) => void,
): Promise<void> {
  const { connected } = await driveStatus();
  if (connected) return;

  onStep?.("구글 계정 연결 중");
  const { url } = await driveConnect();
  openLink(url);
  await driveConnectWait();
}
