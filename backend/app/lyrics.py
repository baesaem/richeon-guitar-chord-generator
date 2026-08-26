"""가사를 찾아 곡에 붙인다.

가사를 손으로 옮겨 적고 타이밍까지 찍는 일은 곡마다 십수 분이 든다.
두 곳에서 순서대로 찾는다.

1. LRCLIB (lrclib.net) — 무료 가사 데이터베이스. 곡 단위로 정리돼 있어
   줄바꿈과 타이밍이 정확하다. 대중적인 곡은 대개 여기 있다.
2. YouTube 자막 — 1에 없을 때. 라이브 영상·옛 가요처럼 데이터베이스에
   없는 곡을 건진다. 자동 생성 자막은 받아쓰기라 오탈자가 있을 수 있다.

어느 쪽도 못 찾으면 빈 목록을 돌려준다(가사는 부가 정보라 분석을
실패시키지 않는다).
"""

from __future__ import annotations

import html
import re

from .config import settings
from .schemas import LyricLine

_UA = "richeon-guitar-chord-generator (https://github.com/baesaem/richeon-guitar-chord-generator)"

# 우선순위: 한국어 → 영어. 곡 대부분이 이 둘 중 하나다.
_LANG_PREFS = ["ko", "ko-KR", "en", "en-US", "en-GB"]

# "00:00:12.345 --> 00:00:15.678" (뒤에 위치 지정자가 붙기도 한다)
_CUE_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})"
)
# 자동 자막의 단어 타이밍 태그: <00:00:12.345><c> word</c>
_INLINE_TAG_RE = re.compile(r"<[^>]+>")
# 자동 자막의 효과음 표기: [음악] [박수] [Music] …
_SOUND_TAG_RE = re.compile(r"[\[(](?:음악|노래|박수|웃음|Music|Applause|Laughter)[\])]", re.I)

# LRC 시간 태그: [mm:ss.xx] — 한 줄 앞에 여러 개가 붙기도 한다
_LRC_TAG_RE = re.compile(r"\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]")

# 영상 제목에서 걷어낼 홍보 문구. 곡명·가수명만 남겨야 검색이 맞는다.
_NOISE = re.compile(
    r"(official|lyrics?|lyric video|m/?v|music video|audio|visualizer|live|"
    r"performance|가사|자막|공식|풀버전|full ver\.?|4k|hd|hq|remaster(ed)?|"
    r"arttrack|art track|color coded)",
    re.IGNORECASE,
)


# ---------------------------------------------------------------- 공통 유틸

def _seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def clean_title(title: str) -> str:
    """영상 제목 → 검색어. 대괄호·채널 꼬리표·홍보 문구를 걷어낸다."""
    text = title
    # "… | KBS 2009.06.21 방송" 처럼 파이프 뒤는 대개 채널·방송 정보다
    text = text.split("|")[0]
    # 대괄호 묶음은 통째로 버린다 ([MV], [ArtTrack], [4K] …)
    text = re.sub(r"\[[^\]]*\]", " ", text)
    # 괄호 안에 홍보 문구가 있으면 그 괄호만 버린다(아티스트 표기는 살린다)
    text = re.sub(r"\(([^)]*)\)", lambda m: " " if _NOISE.search(m.group(1)) else m.group(0), text)
    text = _NOISE.sub(" ", text)
    # 남은 구분자·중복 공백 정리
    text = re.sub(r"[-–—_/·]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------- LRC 파싱

def parse_lrc(text: str) -> list[LyricLine]:
    """LRC → 가사 줄 목록. 시간 태그가 없는 줄(메타데이터)은 버린다."""
    rows: list[tuple[float, str]] = []
    for raw in text.splitlines():
        tags = list(_LRC_TAG_RE.finditer(raw))
        if not tags:
            continue
        body = raw[tags[-1].end() :].strip()
        if not body:
            continue  # 간주 표시(빈 줄)는 넣지 않는다
        for tag in tags:
            mm, ss, frac = tag.group(1, 2, 3)
            # [mm:ss.xx]의 xx는 1/100초, [mm:ss.xxx]는 1/1000초다
            sub = 0.0
            if frac:
                sub = int(frac) / (1000 if len(frac) == 3 else 100)
            rows.append((int(mm) * 60 + int(ss) + sub, body))

    rows.sort(key=lambda r: r[0])
    lines: list[LyricLine] = []
    for i, (t, body) in enumerate(rows):
        end = rows[i + 1][0] if i + 1 < len(rows) else 0.0
        lines.append(LyricLine(t=round(t, 2), end=round(end, 2), text=body))
    return lines


# ---------------------------------------------------------------- 웹 가사

def fetch_lrclib(title: str, duration: float) -> list[LyricLine]:
    """LRCLIB에서 곡을 찾아 동기화 가사를 가져온다.

    길이가 비슷한 결과만 받아들인다. 같은 제목의 다른 곡·다른 편곡을
    가져다 붙이면 가사가 통째로 어긋나기 때문이다.
    """
    import httpx

    query = clean_title(title)
    if not query:
        return []

    with httpx.Client(timeout=20.0, headers={"User-Agent": _UA}) as client:
        res = client.get("https://lrclib.net/api/search", params={"q": query})
        if res.status_code != 200:
            return []
        hits = res.json()

    # 시간 없는 가사는 동기화에 못 쓴다
    synced = [h for h in hits if h.get("syncedLyrics")]
    if not synced:
        return []

    if duration:
        # 길이를 알면 15초 이내에서 가장 가까운 것. 같은 제목의 다른 곡·
        # 다른 편곡을 가져다 붙이면 가사가 통째로 어긋나기 때문이다.
        near = [
            (abs(float(h.get("duration") or 0) - duration), h)
            for h in synced
            if h.get("duration")
        ]
        near = [(gap, h) for gap, h in near if gap <= 15]
        if not near:
            return []
        best = min(near, key=lambda pair: pair[0])[1]
    else:
        # 사용자가 검색어를 직접 준 경우. 첫 동기화 결과를 쓴다.
        best = synced[0]

    return parse_lrc(best["syncedLyrics"])


# ---------------------------------------------------------------- 자막 파싱

def parse_vtt(text: str) -> list[LyricLine]:
    """WebVTT/SRT → 가사 줄 목록. 빈 줄·중복·태그를 걷어낸다."""
    lines: list[LyricLine] = []
    start: float | None = None
    end: float | None = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal start, end, buffer
        if start is not None and buffer:
            body = " ".join(buffer).strip()
            if body:
                lines.append(
                    LyricLine(t=round(start, 2), end=round(end or start, 2), text=body)
                )
        start, end, buffer = None, None, []

    for raw in text.splitlines():
        line = raw.rstrip()
        if m := _CUE_RE.search(line):
            flush()
            start = _seconds(*m.group(1, 2, 3, 4))
            end = _seconds(*m.group(5, 6, 7, 8))
            continue
        if not line.strip():
            flush()
            continue
        if line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE", "STYLE")):
            continue
        cleaned = _clean_caption(line)
        if cleaned:
            buffer.append(cleaned)
    flush()

    return _dedupe(lines)


def _clean_caption(line: str) -> str:
    """자막 한 줄에서 태그·엔티티·효과음 표기를 걷어낸다."""
    text = _INLINE_TAG_RE.sub("", line)
    text = html.unescape(text)          # &gt; &amp; &#39; …
    text = _SOUND_TAG_RE.sub(" ", text)  # [음악] [박수] …
    text = text.replace(">>", " ")       # 화자 전환 표시
    return re.sub(r"\s+", " ", text).strip()


def _strip_overlap(prev: str, cur: str) -> str:
    """앞 줄 끝과 겹치는 부분을 뒤 줄 앞에서 잘라낸다.

    자동 자막은 창을 밀어 가며 같은 말을 반복 송출한다.
      1: "꿈을 부담이 깊을수록"
      2: "꿈을 부담이 깊을수록 말없이 서로를 싸우며"
    이런 겹침을 걷어내야 가사가 한 번씩만 읽힌다. 짧은 겹침(조사 정도)은
    우연일 수 있어 네 글자 이상일 때만 자른다.
    """
    limit = min(len(prev), len(cur))
    for n in range(limit, 3, -1):
        if prev.endswith(cur[:n]):
            return cur[n:].strip()
    return cur


def _dedupe(lines: list[LyricLine]) -> list[LyricLine]:
    """자동 자막의 롤업 중복을 없앤다."""
    out: list[LyricLine] = []
    for line in lines:
        text = line.text
        if out:
            prev = out[-1].text
            if text == prev or text in prev:
                continue  # 같은 말이거나 앞 줄에 이미 들어 있다
            if prev in text:
                # 앞 줄이 통째로 들어 있으면 늘어난 부분만 남긴다
                text = text.replace(prev, "", 1).strip()
            else:
                text = _strip_overlap(prev, text)
            if not text:
                continue
        out.append(LyricLine(t=line.t, end=line.end, text=text))
    return out


def _pick_track(subs: dict, autos: dict) -> list | None:
    """언어 우선순위에 따라 자막 트랙을 고른다. 수동 자막이 항상 먼저."""
    for source in (subs, autos):
        if not source:
            continue
        for lang in _LANG_PREFS:
            if lang in source:
                return source[lang]
        # ko-XXXX 처럼 지역/버전 꼬리표가 붙은 코드도 받아 준다
        for prefix in _LANG_PREFS:
            for lang, formats in source.items():
                if lang.startswith(prefix):
                    return formats
        return next(iter(source.values()))
    return None


def fetch_youtube_captions(video_id: str) -> list[LyricLine]:
    """영상 자막을 받아 가사 줄 목록을 만든다. 없으면 빈 목록."""
    import httpx
    import yt_dlp

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(
            f"https://www.youtube.com/watch?v={video_id}", download=False
        )

    formats = _pick_track(
        info.get("subtitles") or {}, info.get("automatic_captions") or {}
    )
    if not formats:
        return []

    # 파서가 다루는 형식만 고른다. vtt를 먼저, 없으면 srt.
    url = None
    for want in ("vtt", "srt"):
        for fmt in formats:
            if fmt.get("ext") == want:
                url = fmt.get("url")
                break
        if url:
            break
    if not url:
        return []

    with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        res = client.get(url)
        res.raise_for_status()
        return parse_vtt(res.text)


# ---------------------------------------------------------------- 진입점

def fetch_lyrics_blocking(
    video_id: str | None,
    title: str = "",
    duration: float = 0.0,
    query: str = "",
) -> list[LyricLine]:
    """웹 가사를 먼저, 없으면 YouTube 자막을 찾는다. 스레드에서 부른다.

    query를 주면 제목 대신 그 검색어로 찾는다. 영상 제목이 곡명과 다를 때
    (라이브 실황·모음집) 사용자가 직접 "가수 곡명"을 넣어 다시 찾는 용도다.
    """
    search = query or title
    if search:
        try:
            # 검색어를 직접 준 경우엔 길이 필터를 풀어 준다. 사용자가
            # 곡을 특정한 상황이라 후보가 적고, 라이브는 길이가 다르다.
            lines = fetch_lrclib(search, 0.0 if query else duration)
            if lines:
                return lines
        except Exception:
            pass  # 가사 서비스가 죽어도 자막으로 계속 간다

    # YouTube 자막은 최근 요청 제한(429)이 잦아 최선 노력으로만 쓴다.
    if video_id and settings.enable_youtube:
        try:
            return fetch_youtube_captions(video_id)
        except Exception:
            pass
    return []
