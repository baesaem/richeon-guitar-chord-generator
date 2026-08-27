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
    fields: "files(id,name)",
    pageSize: "1000",
    key: DRIVE_API_KEY,
  });
  const res = await fetch(`${API}/files?${params}`);
  if (!res.ok) throw new Error(`드라이브 목록 조회 실패 (HTTP ${res.status})`);
  const body = (await res.json()) as { files?: { id: string; name: string }[] };
  return (body.files ?? []).map((f) => ({ id: f.id, name: f.name }));
}

async function fetchFile(fileId: string): Promise<Response> {
  const res = await fetch(`${API}/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`);
  if (!res.ok) throw new Error(`드라이브 내려받기 실패 (HTTP ${res.status})`);
  return res;
}

export async function downloadDirectText(fileId: string): Promise<string> {
  return (await fetchFile(fileId)).text();
}

export async function downloadDirectBlob(fileId: string): Promise<Blob> {
  return (await fetchFile(fileId)).blob();
}
