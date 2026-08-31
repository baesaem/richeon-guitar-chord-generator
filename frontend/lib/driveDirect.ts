"use client";

import type { SharedFile } from "./api";

/**
 * 분석 서버 없이(정적 배포) 구글드라이브 공유 폴더를 직접 읽는다.
 *
 * 드라이브 웹 페이지는 다른 사이트에서 fetch가 막혀 있지만(CORS),
 * 공식 Drive API(www.googleapis.com)는 API 키만 있으면 브라우저에서
 * 바로 부를 수 있다. 폴더가 "링크가 있는 모든 사용자 - 뷰어" 공개라서
 * 로그인 없이 키만으로 목록·다운로드가 된다.
 *
 * 키는 빌드 시 NEXT_PUBLIC_DRIVE_API_KEY로 넣거나 아래 상수에 적는다.
 * (조회 전용 공개 키라 화면 코드에 실려도 문제없지만, Google Cloud에서
 * HTTP 리퍼러를 배포 주소로 제한해 두는 것이 좋다.)
 */

const DRIVE_API_KEY = process.env.NEXT_PUBLIC_DRIVE_API_KEY ?? "";

const API = "https://www.googleapis.com/drive/v3";

/** 직접 조회가 가능한 빌드인가 (키가 들어 있는가) */
export function hasDriveKey(): boolean {
  return DRIVE_API_KEY.length > 0;
}

export async function listSharedDirect(folderId: string): Promise<SharedFile[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    pageSize: "1000",
    key: DRIVE_API_KEY,
  });
  const res = await fetch(`${API}/files?${params}`);
  if (!res.ok) throw new Error(`드라이브 목록 조회 실패 (HTTP ${res.status})`);
  const body = (await res.json()) as {
    files?: { id: string; name: string; modifiedTime?: string }[];
  };
  return (body.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    modified: f.modifiedTime,
  }));
}

async function fetchFile(fileId: string): Promise<Response> {
  const res = await fetch(`${API}/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`);
  if (res.ok) return res;

  /* 왜 못 받았는지 사람 말로 알려 준다.
   *
   * 구글은 막을 때 JSON이 아니라 「Sorry...」라는 HTML 쪽을 돌려준다.
   * 그것을 그대로 「HTTP 403」이라고만 적으면 받는 사람은 무엇을 해야
   * 할지 알 수 없다 — 기다리면 풀리는 일인데 앱이 고장 난 줄 안다.
   */
  const body = await res.text().catch(() => "");
  if (res.status === 403 && /Sorry|automated queries/i.test(body)) {
    throw new Error(
      "구글이 이 기기·망에서 내려받기를 잠시 막았습니다. " +
        "짧은 사이에 여러 곡을 받으면 그럽니다 — 5~10분 뒤에 다시 하거나 " +
        "와이파이·데이터를 바꿔 보십시오.",
    );
  }
  if (res.status === 403 && /referer/i.test(body)) {
    throw new Error("드라이브 열쇠가 이 주소에서는 막혀 있습니다 (관리자에게 알려 주세요).");
  }
  if (res.status === 404) throw new Error("드라이브에서 파일을 찾지 못했습니다.");
  throw new Error(`드라이브 내려받기 실패 (HTTP ${res.status})`);
}

export async function downloadDirectText(fileId: string): Promise<string> {
  return (await fetchFile(fileId)).text();
}

export async function downloadDirectBlob(fileId: string): Promise<Blob> {
  return (await fetchFile(fileId)).blob();
}
