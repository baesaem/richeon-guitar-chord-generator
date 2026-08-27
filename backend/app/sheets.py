"""웹에서 이 곡의 코드 악보를 찾는다.

악보 이미지를 가져와 앱에 띄우지는 않는다. 남이 만든 악보를 복제해
보여주는 일이라 저작권에 걸린다. 대신 **공개된 악보 페이지를 찾아
목록으로 보여주고**, 사용자는 눌러서 그 사이트에서 정식으로 본다.

검색은 DuckDuckGo의 HTML 페이지를 쓴다. API 키가 필요 없고, 로그인도
요구하지 않으며, 결과가 광고에 덜 밀린다.
"""

from __future__ import annotations

import html
import re
from urllib.parse import parse_qs, unquote, urlparse

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

_RESULT_RE = re.compile(
    r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', re.S
)
_TAG_RE = re.compile(r"<[^>]+>")

# 검색어에서 걷어낼 홍보 문구. 영상 제목을 그대로 넣으면 악보가 안 나온다.
_NOISE = re.compile(
    r"(official|lyrics?|lyric video|m/?v|music video|audio|visualizer|live|"
    r"performance|가사|자막|공식|풀버전|full ver\.?|4k|hd|hq|remaster(ed)?|"
    r"arttrack|art track|color coded)",
    re.IGNORECASE,
)

# 코드 악보를 실제로 올려 두는 곳들. 위에 있을수록 먼저 보여준다.
_TRUSTED = [
    "weingchicken.com",   # 위잉기타
    "ezcho.com",          # 이지코드
    "akbobada.com",       # 악보바다
    "musicscore.co.kr",
    "bomione.co.kr",
    "ezguitar.net",       # 황선생기타교실
    "chordify.net",
    "ultimate-guitar.com",
    "tistory.com",
    "blog.naver.com",
    "cafe.daum.net",
    "cafe.naver.com",
]

# 악보와 무관한 곳
_BLOCKED = ["youtube.com", "youtu.be", "melon.com", "genie.co.kr", "bugs.co.kr", "spotify.com"]


def clean_query(title: str) -> str:
    """영상 제목 → 악보 검색어."""
    text = title.split("|")[0]
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\(([^)]*)\)", lambda m: " " if _NOISE.search(m.group(1)) else m.group(0), text)
    text = _NOISE.sub(" ", text)
    text = re.sub(r"\(\d{4}\)|\b(19|20)\d{2}\b", " ", text)   # 연도
    text = re.sub(r"[-–—_/·]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _real_url(href: str) -> str:
    """DuckDuckGo가 감싼 주소를 원래 주소로 되돌린다."""
    if href.startswith("//duckduckgo.com/l/") or "/l/?uddg=" in href:
        query = parse_qs(urlparse(f"https:{href}" if href.startswith("//") else href).query)
        target = query.get("uddg", [""])[0]
        if target:
            return unquote(target)
    return href


def _rank(url: str) -> int:
    """믿을 만한 악보 사이트를 앞으로. 목록에 없으면 뒤로 민다."""
    for i, host in enumerate(_TRUSTED):
        if host in url:
            return i
    return len(_TRUSTED)


def search(title: str, limit: int = 8) -> list[dict]:
    """곡 제목으로 코드 악보 페이지를 찾는다. 실패하면 빈 목록."""
    import httpx

    query = clean_query(title)
    if not query:
        return []

    try:
        res = httpx.post(
            "https://html.duckduckgo.com/html/",
            data={"q": f"{query} 기타 코드 악보"},
            headers={"User-Agent": _UA},
            timeout=20.0,
            follow_redirects=True,
        )
        res.raise_for_status()
    except Exception:
        return []

    seen: set[str] = set()
    found: list[dict] = []
    for href, raw_title in _RESULT_RE.findall(res.text):
        url = _real_url(href)
        if not url.startswith("http"):
            continue
        if any(bad in url for bad in _BLOCKED):
            continue
        host = urlparse(url).netloc.replace("www.", "").replace("m.", "")
        if url in seen:
            continue
        seen.add(url)
        found.append(
            {
                "title": html.unescape(_TAG_RE.sub("", raw_title)).strip(),
                "url": url,
                "site": host,
            }
        )

    found.sort(key=lambda r: _rank(r["url"]))
    return found[:limit]
