"""강상기타반 공유 재생목록 — 구글드라이브 공개 폴더 프록시.

브라우저가 드라이브 파일을 fetch로 직접 읽는 것은 CORS로 막혀 있어
서버가 대신 받아 넘겨준다. 공개(링크 공유) 폴더만 동작하며 인증은 없다.

목록은 embeddedfolderview 페이지(서버사이드 렌더)를 파싱해 얻는다.
구글이 이 페이지 구조를 바꾸면 파싱이 깨질 수 있으므로, 파싱 결과가
비면 "폴더가 비었거나 구조가 바뀜"으로 안내한다.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

from .config import settings

_LIST_URL = "https://drive.google.com/embeddedfolderview?id={folder_id}"
_FILE_URL = "https://drive.google.com/uc?export=download&id={file_id}"

# <div class="flip-entry" id="entry-FILEID"> ... <div class="flip-entry-title">NAME</div>
_ENTRY_RE = re.compile(
    r'id="entry-([A-Za-z0-9_-]{10,})".*?flip-entry-title">([^<]+)<',
    re.DOTALL,
)

_FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,}$")


@dataclass
class SharedFile:
    id: str
    name: str


def _fetch_blocking(url: str) -> bytes:
    import httpx

    with httpx.Client(follow_redirects=True, timeout=30.0) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.content


async def list_shared() -> list[SharedFile]:
    html = (
        await asyncio.to_thread(
            _fetch_blocking, _LIST_URL.format(folder_id=settings.shared_folder_id)
        )
    ).decode("utf-8", "replace")

    return [
        SharedFile(id=file_id, name=name.strip())
        for file_id, name in _ENTRY_RE.findall(html)
    ]


async def download_shared(file_id: str) -> bytes:
    if not _FILE_ID_RE.match(file_id):
        raise ValueError("잘못된 파일 id입니다")
    return await asyncio.to_thread(
        _fetch_blocking, _FILE_URL.format(file_id=file_id)
    )
