"use client";

/**
 * 폰·태블릿에서 강사님이 드라이브에 곧장 올리기 — 분석 서버 없이.
 *
 * 지금까지 올리기는 강사님 PC의 분석 서버가 받아 둔 구글 동의로만 됐다
 * (drive_upload.py). 밖에서 폰으로 강의실을 고치면 올릴 길이 없었다(강사님:
 * 「스마트폰/태블릿 등에서 관리자모드에서 강좌 드라이브에 올릴 수 있게」).
 * 여기서는 브라우저가 구글 로그인(Google Identity Services)으로 잠깐 쓰는
 * 열쇠(access token)를 받아 Drive API에 바로 올린다.
 *
 * 권한은 서버와 같은 drive.file 하나 — 이 앱이 만든 파일만 손댄다. 서버와
 * 같은 구글 클라우드 프로젝트의 웹 클라이언트를 쓰면, 서버가 올려 둔 파일도
 * 같은 앱의 것이라 같은 이름이면 그대로 갈아 끼운다(사본이 쌓이지 않는다).
 *
 * 웹 클라이언트 id는 빌드 때 NEXT_PUBLIC_GOOGLE_CLIENT_ID로 넣는다(비밀이
 * 아니다). 없으면 이 길은 꺼져 있다.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const GIS_SRC = "https://accounts.google.com/gsi/client";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenError {
  type?: string;
  message?: string;
}
interface TokenClient {
  callback: (r: TokenResponse) => void;
  error_callback?: (e: TokenError) => void;
  requestAccessToken: (o?: { prompt?: string }) => void;
}
interface GoogleOAuth2 {
  initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: TokenError) => void;
  }) => TokenClient;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

/** 이 빌드에 폰·태블릿 올리기가 켜져 있는가(웹 클라이언트 id가 들어 있는가) */
export function hasBrowserDrive(): boolean {
  return CLIENT_ID.length > 0;
}

let gisLoading: Promise<void> | null = null;

/**
 * 구글 로그인 스크립트를 미리 불러 둔다. 누른 그 순간에 로그인 창이 떠야
 * 폰 브라우저가 창을 막지 않는다 — 누른 뒤에 불러오면 늦는다.
 */
export function preloadGoogleLogin(): Promise<void> {
  if (typeof window === "undefined" || window.google?.accounts?.oauth2)
    return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error("구글 로그인을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

let token: { value: string; until: number } | null = null;
let client: TokenClient | null = null;

/**
 * 쓸 열쇠를 받는다. 처음이거나 한 시간이 지나면 구글 로그인 창이 뜬다(한 번
 * 동의해 두면 다음부터는 계정만 고르거나 곧 닫힌다).
 *
 * **단추를 누른 그 자리에서, 기다리기(await) 전에 불러야 한다** — 폰 브라우저는
 * 누름과 떨어져 뜨는 창을 막는다. Promise를 만드는 순간 창을 연다.
 */
function getToken(): Promise<string> {
  if (token && Date.now() < token.until) return Promise.resolve(token.value);
  const oauth2 = typeof window === "undefined" ? undefined : window.google?.accounts?.oauth2;
  if (!oauth2)
    return Promise.reject(
      new Error("구글 로그인이 아직 준비되지 않았습니다. 잠시 뒤 다시 눌러 주세요."),
    );
  return new Promise((resolve, reject) => {
    const done = (r: TokenResponse) => {
      if (!r.access_token) {
        reject(
          new Error(
            r.error === "access_denied"
              ? "구글 동의를 받지 못했습니다. 다시 눌러 동의해 주세요."
              : `구글 로그인 실패 (${r.error_description || r.error || "알 수 없음"})`,
          ),
        );
        return;
      }
      token = {
        value: r.access_token,
        until: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000,
      };
      resolve(r.access_token);
    };
    const fail = (e: TokenError) =>
      reject(
        new Error(
          e.type === "popup_closed"
            ? "구글 로그인 창을 닫았습니다. 다시 눌러 주세요."
            : e.type === "popup_failed_to_open"
              ? "구글 로그인 창이 막혔습니다. 브라우저의 팝업 차단을 풀어 주세요."
              : `구글 로그인 실패 (${e.message || e.type || "알 수 없음"})`,
        ),
      );
    if (!client)
      client = oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: done,
        error_callback: fail,
      });
    client.callback = done;
    client.error_callback = fail;
    client.requestAccessToken({ prompt: "" });
  });
}

/** 드라이브 검색 글에 넣을 이름 — 따옴표와 역슬래시를 막는다 */
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * 드라이브 폴더에 파일 하나를 올린다. 같은 이름(이 앱이 올린 것)이 있으면
 * 그 파일을 갈아 끼운다 — 서버의 upload와 같은 약속이다.
 *
 * 단추를 누른 자리에서 곧장 부른다(첫 줄에서 로그인 창을 연다).
 */
export async function browserDriveUpload(
  folderId: string,
  name: string,
  blob: Blob,
): Promise<{ id: string; name: string; replaced: boolean }> {
  const auth = await getToken();
  const headers = { Authorization: `Bearer ${auth}` };
  const expired = () => {
    token = null;
    return new Error("구글 로그인이 풀렸습니다. 다시 눌러 주세요.");
  };

  const q = `name = '${quote(name)}' and '${folderId}' in parents and trashed = false`;
  const found = await fetch(
    `${API}/files?${new URLSearchParams({ q, fields: "files(id,name)", pageSize: "1" })}`,
    { headers },
  );
  if (found.status === 401) throw expired();
  const existing = found.ok
    ? ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id
    : undefined;

  const meta = existing ? { name } : { name, parents: [folderId] };
  const boundary = `richeon${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n--${boundary}\r\n` +
      `Content-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await fetch(
    existing
      ? `${UPLOAD_API}/files/${existing}?uploadType=multipart&fields=id,name`
      : `${UPLOAD_API}/files?uploadType=multipart&fields=id,name`,
    {
      method: existing ? "PATCH" : "POST",
      headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (res.status === 401) throw expired();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 403 || res.status === 404
        ? "이 구글 계정으로는 그 드라이브 폴더에 올릴 수 없습니다. 강사님 계정으로 로그인했는지 확인해 주세요."
        : `드라이브에 올리지 못했습니다 (${res.status}) ${text.slice(0, 160)}`,
    );
  }
  const data = (await res.json()) as { id: string; name: string };
  return { id: data.id, name: data.name, replaced: !!existing };
}
