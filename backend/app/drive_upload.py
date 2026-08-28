"""구글 드라이브에 바로 올리기 (관리자 전용).

지금까지는 「내보내기 → 파일 내려받기 → 드라이브 웹에서 올리기」 세 걸음
이었다. 선생님이 곡을 고칠 때마다 이 걸음을 되풀이한다.

여기서는 선생님 구글 계정으로 한 번만 동의를 받아 두고, 그 뒤로는
앱에서 누르면 서버가 곧장 공유 폴더에 올린다. 파일 주인이 선생님이라
드라이브에서 그대로 정리·삭제할 수 있다.

권한은 drive.file 하나만 받는다 — 이 앱이 만든 파일에만 손댈 수 있고
드라이브의 나머지는 들여다보지 못한다. 민감 권한이 아니라 구글 심사
없이도 경고 화면 없이 동의된다.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import httpx

from .config import settings

SCOPE = "https://www.googleapis.com/auth/drive.file"
AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"

_SECRETS = Path(__file__).resolve().parent.parent / "secrets"
CLIENT_FILE = _SECRETS / "google_oauth_client.json"
TOKEN_FILE = _SECRETS / "google_token.json"


class DriveError(RuntimeError):
    """사람에게 그대로 보여 줄 수 있는 실패 사유."""


def _client() -> dict:
    if not CLIENT_FILE.exists():
        raise DriveError(
            "구글 OAuth 클라이언트 파일이 없습니다"
            f" ({CLIENT_FILE.name}을(를) backend/secrets 에 두세요)"
        )
    data = json.loads(CLIENT_FILE.read_text("utf-8"))
    return data.get("installed") or data.get("web") or {}


def _load_token() -> dict | None:
    if not TOKEN_FILE.exists():
        return None
    try:
        return json.loads(TOKEN_FILE.read_text("utf-8"))
    except Exception:
        return None


def _save_token(token: dict) -> None:
    _SECRETS.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(token, ensure_ascii=False), "utf-8")


def connected() -> bool:
    token = _load_token()
    return bool(token and token.get("refresh_token"))


# ------------------------------------------------------------------ 한 번 동의

class _CodeCatcher(BaseHTTPRequestHandler):
    """동의가 끝나면 구글이 이 자리로 돌려보낸다. 코드만 받아 적는다."""

    code: str | None = None
    state: str = ""

    def do_GET(self) -> None:  # noqa: N802  (BaseHTTPRequestHandler 규약)
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        ok = params.get("state", [""])[0] == _CodeCatcher.state
        if ok and "code" in params:
            _CodeCatcher.code = params["code"][0]
            body = "연결됐습니다. 이 창을 닫고 앱으로 돌아가세요."
        else:
            body = "연결하지 못했습니다. 앱에서 다시 눌러 주세요."
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            f"<html><body style='font-family:sans-serif;padding:2rem'>{body}</body></html>".encode()
        )

    def log_message(self, *args) -> None:  # 서버 로그를 어지럽히지 않는다
        pass


def start_consent() -> str:
    """동의 화면 주소를 만들고, 돌아올 자리를 열어 둔다.

    데스크톱 클라이언트라 돌아올 자리는 이 PC의 localhost다. 앱이 이
    주소를 열어 주면 선생님이 계정을 고르고 동의하면 된다.
    """
    client = _client()
    _CodeCatcher.code = None
    _CodeCatcher.state = secrets.token_urlsafe(16)

    server = HTTPServer(("127.0.0.1", 0), _CodeCatcher)
    port = server.server_address[1]
    threading.Thread(target=server.handle_request, daemon=True).start()
    # 코드를 받고 나면 문을 닫는다. handle_request가 한 번만 받으므로
    # 아래 wait_consent가 끝나는 시점과 맞물린다.
    _pending["server"] = server
    _pending["redirect"] = f"http://localhost:{port}"

    params = {
        "client_id": client["client_id"],
        "redirect_uri": _pending["redirect"],
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # 이미 동의한 계정이라도 갱신 토큰을 다시 받으려면 필요하다
        "prompt": "consent",
        "state": _CodeCatcher.state,
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


_pending: dict = {}


def wait_consent(timeout: float = 180.0) -> bool:
    """동의가 끝날 때까지 기다렸다가 토큰을 저장한다."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _CodeCatcher.code:
            break
        time.sleep(0.4)
    code = _CodeCatcher.code
    _CodeCatcher.code = None
    if not code:
        raise DriveError("동의를 마치지 못했습니다. 다시 눌러 주세요.")

    client = _client()
    res = httpx.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "redirect_uri": _pending.get("redirect", "http://localhost"),
            "grant_type": "authorization_code",
        },
        timeout=30.0,
    )
    if res.status_code != 200:
        raise DriveError(f"토큰을 받지 못했습니다 ({res.status_code})")
    token = res.json()
    if not token.get("refresh_token"):
        raise DriveError("갱신 토큰이 오지 않았습니다. 동의를 다시 해 주세요.")
    token["obtained_at"] = time.time()
    _save_token(token)
    return True


def disconnect() -> None:
    TOKEN_FILE.unlink(missing_ok=True)


# ------------------------------------------------------------------ 올리기

def _access_token() -> str:
    token = _load_token()
    if not token or not token.get("refresh_token"):
        raise DriveError("드라이브에 연결되어 있지 않습니다. 먼저 연결해 주세요.")

    fresh_until = token.get("obtained_at", 0) + token.get("expires_in", 0) - 60
    if token.get("access_token") and time.time() < fresh_until:
        return token["access_token"]

    client = _client()
    res = httpx.post(
        TOKEN_URL,
        data={
            "client_id": client["client_id"],
            "client_secret": client["client_secret"],
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=30.0,
    )
    if res.status_code != 200:
        raise DriveError(
            "연결이 풀렸습니다. 설정에서 드라이브를 다시 연결해 주세요."
        )
    new = res.json()
    token["access_token"] = new["access_token"]
    token["expires_in"] = new.get("expires_in", 3600)
    token["obtained_at"] = time.time()
    _save_token(token)
    return token["access_token"]


def _find_existing(client: httpx.Client, folder_id: str, name: str) -> str | None:
    """같은 이름으로 이 앱이 올려 둔 파일. 있으면 덮어쓴다."""
    safe = name.replace("'", "\\'")
    res = client.get(
        f"{API}/files",
        params={
            "q": f"name = '{safe}' and '{folder_id}' in parents and trashed = false",
            "fields": "files(id,name)",
            "pageSize": "1",
        },
    )
    if res.status_code != 200:
        return None
    files = res.json().get("files", [])
    return files[0]["id"] if files else None


def upload(folder_id: str, name: str, data: bytes, mime: str) -> dict:
    """공유 폴더에 파일을 올린다. 같은 이름이 있으면 그 파일을 갈아 끼운다."""
    if folder_id not in settings.shared_folder_ids:
        raise DriveError("알 수 없는 폴더입니다")

    token = _access_token()
    with httpx.Client(
        headers={"Authorization": f"Bearer {token}"}, timeout=300.0
    ) as client:
        existing = _find_existing(client, folder_id, name)
        meta = {"name": name} if existing else {"name": name, "parents": [folder_id]}
        files = {
            "metadata": ("metadata", json.dumps(meta), "application/json; charset=UTF-8"),
            "file": (name, data, mime),
        }
        if existing:
            res = client.patch(
                f"{UPLOAD_API}/files/{existing}",
                params={"uploadType": "multipart", "fields": "id,name"},
                files=files,
            )
        else:
            res = client.post(
                f"{UPLOAD_API}/files",
                params={"uploadType": "multipart", "fields": "id,name"},
                files=files,
            )
        if res.status_code not in (200, 201):
            raise DriveError(f"올리지 못했습니다 ({res.status_code}) {res.text[:200]}")
        body = res.json()
        return {"id": body.get("id"), "name": body.get("name"), "replaced": bool(existing)}
