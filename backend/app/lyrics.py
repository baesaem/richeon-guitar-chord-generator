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
import json
import re

from . import llm
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

def _lrclib_hits(query: str) -> list[dict]:
    import httpx

    with httpx.Client(timeout=20.0, headers={"User-Agent": _UA}) as client:
        res = client.get("https://lrclib.net/api/search", params={"q": query})
        if res.status_code != 200:
            return []
        return res.json()


_TOKEN = re.compile(r"[0-9a-z가-힣]+")


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN.findall(text.lower()) if len(t) >= 2}


def song_matches(hit: dict, artists: list[str], song_title: str) -> bool:
    """이 검색 결과가 우리가 찾던 곡인가.

    로마자로 찾으면 엉뚱한 곡이 잘 걸린다. 실측: "이장희 - 그건 너"의
    영어 번역 제목 "That's You"로 검색하니 Lucky Daye·Gold Revere 등
    무관한 영어 곡이 20건 나왔고, 그중 하나는 길이가 3초 차이라 길이
    검사도 통과해 그대로 붙었다.

    가수만 봐도 안 된다. 옛 가요는 동기화 가사가 리메이크한 가수 이름으로
    올라 있다 — "그건 너"의 동기화 가사는 이장희가 아니라 민해경으로
    등록돼 있다. 그래도 가사는 같은 곡이다.

    그래서 **가수가 맞거나, 원래 제목이 맞으면** 받아들인다. 제목은
    원문(한글)으로만 맞춘다. 번역 제목으로 맞추면 "That's You"가 다시
    통과한다. 둘 다 모르면 검사하지 않는다.
    """
    known_artist = [a for a in artists if a]
    if not known_artist and not song_title:
        return True

    for name in known_artist:
        if _tokens(name) & _tokens(str(hit.get("artistName") or "")):
            return True
    if song_title and _tokens(song_title) & _tokens(str(hit.get("trackName") or "")):
        return True
    return False


def fetch_lrclib_plain(
    title: str,
    duration: float,
    artists: list[str] | None = None,
    song_title: str = "",
) -> list[str]:
    """시각 없는 가사 본문. 동기화 가사가 없을 때의 차선책.

    시각이 없어 악보에 정확히 붙지는 않지만, 진짜 가사라는 점에서 AI가
    적어 주는 것보다 낫다. 시각은 부르는 쪽에서 고르게 나눠 붙인다.
    """
    query = clean_title(title)
    if not query:
        return []
    try:
        hits = _lrclib_hits(query)
    except Exception:
        return []

    plain = [h for h in hits if h.get("plainLyrics")]
    plain = [h for h in plain if song_matches(h, artists or [], song_title)]
    if duration:
        near = [
            (abs(float(h.get("duration") or 0) - duration), h)
            for h in plain
            if h.get("duration")
        ]
        near = [pair for pair in near if pair[0] <= 15]
        if not near:
            return []
        best = min(near, key=lambda pair: pair[0])[1]
    elif plain:
        best = plain[0]
    else:
        return []

    lines = [line.strip() for line in str(best["plainLyrics"]).splitlines()]
    return [line for line in lines if line]


def fetch_lrclib(
    title: str,
    duration: float,
    artists: list[str] | None = None,
    song_title: str = "",
) -> list[LyricLine]:
    """LRCLIB에서 곡을 찾아 동기화 가사를 가져온다.

    길이가 비슷한 결과만 받아들인다. 같은 제목의 다른 곡·다른 편곡을
    가져다 붙이면 가사가 통째로 어긋나기 때문이다.
    """
    query = clean_title(title)
    if not query:
        return []

    hits = _lrclib_hits(query)

    # 시간 없는 가사는 동기화에 못 쓴다
    synced = [h for h in hits if h.get("syncedLyrics")]
    synced = [h for h in synced if song_matches(h, artists or [], song_title)]
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


def parse_json3(text: str) -> list[LyricLine]:
    """YouTube json3 자막 → 가사 줄 목록.

    **자동 자막은 이 형식으로 받는다.** vtt로 받으면 롤업(같은 말을 창을
    밀어 가며 되풀이 송출) 때문에 줄이 겹쳐 나오고, 그 겹침을 걷어내다
    멀쩡한 줄까지 지운다 — 실측에서 두 줄에 한 줄꼴로 사라졌다.

    json3에는 한 소절이 한 덩이(event)로 들어 있고 시작 시각이 밀리초로
    적혀 있다. 걷어낼 겹침도, 맞출 시각도 없다.
    """
    try:
        data = json.loads(text)
    except ValueError:
        return []

    rows: list[LyricLine] = []
    for event in data.get("events") or []:
        segs = event.get("segs") or []
        body = "".join(seg.get("utf8", "") for seg in segs)
        body = _clean_caption(body.replace("\n", " "))
        if not body:
            continue
        start = float(event.get("tStartMs", 0)) / 1000
        dur = float(event.get("dDurationMs", 0)) / 1000
        rows.append(LyricLine(t=round(start, 2), end=round(start + dur, 2), text=body))

    rows.sort(key=lambda r: r.t)
    # 같은 말이 곧바로 되풀이되면 하나만 남긴다(드물게 겹치는 경우가 있다)
    out: list[LyricLine] = []
    for row in rows:
        if out and out[-1].text == row.text and row.t - out[-1].t < 0.5:
            continue
        out.append(row)
    return out


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

    # json3을 먼저 고른다. 자동 자막의 롤업 중복이 없어 줄을 잃지 않는다.
    # 없을 때만 vtt·srt로 내려간다(수동 자막은 어느 쪽이든 같다).
    url = None
    kind = ""
    for want in ("json3", "vtt", "srt"):
        for fmt in formats:
            if fmt.get("ext") == want:
                url, kind = fmt.get("url"), want
                break
        if url:
            break
    if not url:
        return []

    with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        res = client.get(url)
        res.raise_for_status()
        return parse_json3(res.text) if kind == "json3" else parse_vtt(res.text)


# ---------------------------------------------------------------- 진입점

def polish_captions(lines: list[LyricLine]) -> list[LyricLine]:
    """자막에서 온 가사를 소절로 다듬는다. 못 다듬으면 그대로 돌려준다.

    자동 자막은 토막나 있고 글자가 틀린다("바라미 차가워진"). 지금까지는
    가사 화면의 단추를 눌러야 다듬어졌는데, 매 곡 눌러야 한다면 그건
    분석이 덜 끝난 것이다. 키가 있으면 분석하면서 바로 건다.

    시각은 자막의 첫 조각 시각이 그대로 남으므로 어림이 아니다.
    """
    if not llm.enabled() or len(lines) < 2:
        return lines
    rows = llm.tidy_lyrics([{"t": line.t, "text": line.text} for line in lines])
    if not rows:
        return lines
    return [
        LyricLine(
            t=row["t"],
            end=rows[i + 1]["t"] if i + 1 < len(rows) else lines[-1].end,
            text=row["text"],
        )
        for i, row in enumerate(rows)
    ]


def align_to_vocals(lines: list[LyricLine], audio_id: str) -> list[LyricLine]:
    """가사 시각을 실제 노래에 맞춘다. 맞출 수 없으면 그대로 돌려준다.

    보컬 트랙이 있으면 어디서 노래가 시작하는지 알 수 있다. 줄마다 가장
    가까운 문구 시작점에 붙인다 — 0.6초 안일 때만. 곡 전체를 통째로 미는
    방식은 이미 잘 맞는 가사를 망가뜨려 쓰지 않는다.
    """
    if len(lines) < 4:
        return lines

    from .analysis.lyric_sync import snap
    from .analysis.separate import vocals_path

    try:
        starts, moved = snap([line.t for line in lines], vocals_path(audio_id))
    except Exception:
        return lines
    if moved == 0:
        return lines

    # 줄이 실제로 얼마나 이어졌는지(end)는 그대로 옮긴다. 다음 줄 시작으로
    # 덮으면 줄 사이의 빈틈이 사라져, 어디서 소절이 끊기는지 알 수 없게 된다.
    fixed = []
    for i, line in enumerate(lines):
        shift = starts[i] - line.t
        end = round(line.end + shift, 2) if line.end > line.t else line.end
        fixed.append(LyricLine(t=starts[i], end=end, text=line.text))
    return fixed


def fetch_lyrics_blocking(
    video_id: str | None,
    title: str = "",
    duration: float = 0.0,
    query: str = "",
) -> tuple[list[LyricLine], bool, str]:
    """가사를 찾는다. 스레드에서 부른다.

    (가사, 시각이_어림인가, 출처)를 돌려준다. 출처는 "lrclib" | "captions" |
    "plain" | "ai" | "" — 자막에서 온 가사는 뒤에서 AI 다듬기를 걸 수 있게
    표식이 필요하다.

    순서대로 내려간다. 위쪽이 정확하다.
      1. 동기화 가사 (LRCLIB) — 시각까지 맞는 진짜 가사
      2. AI가 만든 표기로 다시 검색 — 표기가 달라 못 찾는 경우를 건진다
      3. YouTube 자막 — 시각은 맞지만 자동 자막은 글자가 자주 틀린다
      4. 시각 없는 가사 (LRCLIB) — 글자는 맞고 시각은 어림
      5. AI가 아는 가사 — 대개 저작권을 이유로 거부한다. 기대하지 말 것

    query를 주면 제목 대신 그 검색어로 찾는다. 영상 제목이 곡명과 다를 때
    (라이브 실황·모음집) 사용자가 직접 "가수 곡명"을 넣어 다시 찾는 용도다.
    """
    # 던져 볼 검색어를 순서대로 모은다.
    artists: list[str] = []
    song_title = ""
    if query:
        # 사용자가 직접 준 검색어. 곡을 특정한 상황이므로 길이 필터를 푼다.
        attempts = [(query, 0.0)]
    else:
        attempts = [(title, duration)] if title else []
        # LLM이 제목에서 가수·곡명을 가려내고 로마자 표기를 만들어 준다.
        # 한국 가요가 가사 데이터베이스에 영문으로 등록된 경우를 건진다
        # ("조용필 단발머리" 0건 → "Cho Yong Pil" 20건).
        info = llm.song_info(title) if title else None
        if info:
            artists = info.artist_names()
            song_title = info.title
            attempts += [(q, duration) for q in info.queries()]
            # 로마자로 찾을 때는 길이만 맞으면 받아들인다. 표기가 달라
            # 후보가 적기 때문이다.
            attempts += [(q, 0.0) for q in info.romanized]

    seen: set[str] = set()
    tried: list[tuple[str, float]] = []
    for search, want_duration in attempts:
        if not search or search in seen:
            continue
        seen.add(search)
        tried.append((search, want_duration))
        try:
            lines = fetch_lrclib(search, want_duration, artists, song_title)
            if lines:
                return lines, False, "lrclib"
        except Exception:
            pass  # 가사 서비스가 죽어도 다음 수단으로 계속 간다

    # 길이가 달라 놓친 경우를 위해 조건 없이 한 번 더. 라이브·리메이크는
    # 원곡과 길이가 다르다 — "그건 너"의 동기화 가사는 228초로 올라 있는데
    # 우리가 가진 영상은 175초다. 곡을 맞추는 일은 위의 검사가 한다.
    if not query and (artists or song_title):
        for search, _ in list(tried):
            try:
                lines = fetch_lrclib(search, 0.0, artists, song_title)
                if lines:
                    return lines, False, "lrclib"
            except Exception:
                pass

    # 표기 문제로 못 찾았을 수 있다. AI에게 다른 표기를 받아 다시 훑는다.
    # 실측: "이장희 그건 너" → Lee Jang Hee / Yi Jang-hui / That's You / 李章熙.
    if not query and llm.enabled():
        artist, song = _song_names(title, "")
        for extra in llm.more_queries(artist, song):
            if extra in seen:
                continue
            seen.add(extra)
            tried.append((extra, 0.0))
            try:
                lines = fetch_lrclib(extra, 0.0, artists, song_title)
                if lines:
                    return lines, False, "lrclib"
            except Exception:
                pass

    # YouTube 자막은 최근 요청 제한(429)이 잦아 최선 노력으로만 쓴다.
    if video_id and settings.enable_youtube:
        try:
            lines = fetch_youtube_captions(video_id)
            if lines:
                return lines, False, "captions"
        except Exception:
            pass

    # 여기부터는 시각이 어림이다. 못 붙이는 것보다 낫다는 판단.
    for search, want_duration in tried:
        plain = fetch_lrclib_plain(search, want_duration, artists, song_title)
        if plain:
            return (
                [LyricLine(**row) for row in llm.spread_lines(plain, duration)],
                True,
                "plain",
            )

    # 마지막으로 AI에게 물어본다. 키가 없으면 조용히 빈 목록.
    if llm.enabled():
        artist, song = _song_names(title, query)
        ai_lines = llm.lyrics_text(artist, song)
        if ai_lines:
            return (
                [LyricLine(**row) for row in llm.spread_lines(ai_lines, duration)],
                True,
                "ai",
            )
    return [], False, ""


def _song_names(title: str, query: str) -> tuple[str, str]:
    """AI에게 물어볼 가수·곡명. 사용자가 검색어를 줬으면 그것을 믿는다."""
    if query:
        parts = query.split()
        return (parts[0], " ".join(parts[1:])) if len(parts) > 1 else ("", query)
    info = llm.song_info(title)
    if info and info.title:
        return info.artist, info.title
    return "", clean_title(title)
