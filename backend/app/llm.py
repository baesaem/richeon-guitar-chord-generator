"""LLM으로 곡 정보를 정리한다.

**오디오 분석에는 쓰지 않는다.** 실제로 재 봤더니 GPT는 오디오를 듣고
조성과 템포를 틀리게 답했다(G장조 곡을 E♭장조, 120BPM을 78BPM). 화성
인식은 전용 모델(BTC)이 하는 일이다.

LLM이 잘하는 것은 **글을 다루는 일**이다. 여기서는 두 가지에 쓴다.

1. 영상 제목에서 가수·곡명 뽑기
   "(1997) 안치환 - 사람이 꽃보다 아름다워 [싱크가사/Lyric Video]"
   같은 제목에서 무엇이 가수이고 무엇이 곡명인지 가려낸다. 규칙으로
   짜면 홍보 문구의 가짓수를 따라갈 수 없다.

2. 로마자 표기 만들기
   가사 데이터베이스(LRCLIB)에 한국 가요가 영문 표기로 등록돼 있어
   한글로는 찾지 못한다. 실측: "조용필 단발머리" 0건, "Cho Yong Pil"
   20건(동기화 가사 포함). 로마자 후보를 함께 던지면 적중률이 오른다.

키가 없으면 조용히 비활성된다. 가사는 부가 기능이라 키가 없다고
분석이 실패해서는 안 된다.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

from .config import settings
from .runtime_config import llm_config


class SongInfo:
    """제목에서 뽑아낸 곡 정보."""

    def __init__(
        self,
        artist: str = "",
        title: str = "",
        romanized: list[str] | None = None,
        artist_romanized: list[str] | None = None,
    ):
        self.artist = artist
        self.title = title
        self.romanized = romanized or []
        # 가수 이름만 로마자로. 찾은 결과가 이 가수의 곡인지 맞춰 보는 데 쓴다.
        # 곡명 로마자를 섞으면 안 된다 — 번역 제목("That's You")이 무관한
        # 영어 곡을 통과시킨다.
        self.artist_romanized = artist_romanized or []

    def artist_names(self) -> list[str]:
        return [n for n in [self.artist, *self.artist_romanized] if n]

    def queries(self) -> list[str]:
        """가사를 찾을 때 던져 볼 검색어들. 그럴듯한 순서대로."""
        out: list[str] = []
        if self.artist and self.title:
            out.append(f"{self.artist} {self.title}")
        if self.title:
            out.append(self.title)
        out.extend(self.romanized)
        # 순서를 지키며 중복만 걷어낸다
        seen: set[str] = set()
        return [q for q in out if q and not (q in seen or seen.add(q))]

    def __repr__(self) -> str:
        return f"SongInfo(artist={self.artist!r}, title={self.title!r}, romanized={self.romanized!r})"


_PROMPT = """다음은 음악 영상의 제목입니다. 여기서 가수 이름과 곡 제목만 가려내세요.

제목: {title}

규칙:
- 발매연도, [MV], [Lyric Video], 방송사명, 프로그램명 같은 부가 정보는 버립니다.
- 한국 곡이면 가수와 곡명의 로마자 표기도 함께 주세요. 해외 가사
  데이터베이스에 영문으로 등록된 경우가 많습니다.
- 모르면 빈 문자열로 두세요. 지어내지 마세요.

- artist_romanized에는 **가수 이름만** 로마자로 여러 표기 넣으세요.
  곡명은 넣지 마세요. 찾은 결과가 이 가수의 곡인지 맞춰 보는 데 씁니다.

JSON만 출력하세요. 설명을 붙이지 마세요.
{{"artist": "...", "title": "...", "artist_romanized": ["Cho Yong Pil", "Jo Yong-pil"], "romanized": ["가수 곡명 로마자", "곡명 영문 번역"]}}"""


def _chat(prompt: str) -> str:
    """OpenAI 호환 chat completions 호출. 실패하면 예외."""
    cfg = llm_config()
    # temperature를 보내지 않는다.
    # gpt-5.6 계열은 0을 거부한다("Only the default (1) value is supported").
    # 최신 모델을 자동으로 고르게 해 둔 터라, 하나라도 거부하는 값이
    # 있으면 그날로 가사 도우미가 멈춘다. 하는 일이 제목 정리라 굳이
    # 온도를 낮출 이유도 없다.
    body = json.dumps(
        {
            "model": cfg["model"],
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode()
    req = urllib.request.Request(
        f"{cfg['base_url'].rstrip('/')}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=settings.llm_timeout) as res:
        data = json.load(res)
    return data["choices"][0]["message"]["content"]


def _parse(raw: str) -> SongInfo:
    """모델 답에서 JSON을 건져낸다. 코드 울타리를 붙여 오는 경우가 있다."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return SongInfo()
    data = json.loads(text[start : end + 1])
    def _list(key: str) -> list[str]:
        value = data.get(key) or []
        if isinstance(value, str):
            value = [value]
        return [str(v).strip() for v in value if str(v).strip()]

    return SongInfo(
        artist=str(data.get("artist") or "").strip(),
        title=str(data.get("title") or "").strip(),
        romanized=_list("romanized"),
        artist_romanized=_list("artist_romanized"),
    )


def enabled() -> bool:
    return bool(llm_config()["api_key"])


# 제목 → 곡 정보. 가사를 한 번 찾는 동안 같은 제목을 서너 번 묻는다 —
# 물을 때마다 몇 초와 호출 비용이 든다. 답이 바뀔 물음이 아니므로 담아 둔다.
_INFO_CACHE: dict[str, SongInfo | None] = {}


def song_info(video_title: str) -> SongInfo | None:
    """영상 제목 → 가수·곡명·로마자. 키가 없거나 실패하면 None."""
    if not enabled() or not video_title.strip():
        return None
    if video_title in _INFO_CACHE:
        return _INFO_CACHE[video_title]
    try:
        info = _parse(_chat(_PROMPT.format(title=video_title)))
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError):
        # 가사는 부가 기능이다. LLM이 죽어도 분석은 그대로 간다.
        # 실패는 담지 않는다 — 다음에 다시 시도할 수 있어야 한다.
        return None
    if len(_INFO_CACHE) > 200:
        _INFO_CACHE.clear()
    _INFO_CACHE[video_title] = info
    return info


# ── 모델 목록 고르기 ──────────────────────────────────────────────
#
# OpenAI든 제미나이든 /models 응답 모양은 같다(제미나이는 OpenAI 호환
# 주소를 제공한다). 다만 제미나이 쪽은 created를 주지 않는 일이 있어,
# 그럴 때는 이름에 박힌 판번호로 새 것을 가린다.

_NOT_CHAT = (
    "embed", "tts", "whisper", "image", "realtime", "audio", "moderation",
    "transcribe", "search", "dall-e", "sora", "veo", "aqa", "computer-use",
)
_CHAT_PREFIX = ("gpt-", "o1", "o3", "o4", "claude", "gemini")
# gpt-5.5-2026-04-23 처럼 날짜가 붙은 스냅샷
_SNAPSHOT = re.compile(r"-(19|20)\d{2}-\d{2}-\d{2}$")
# gemini-2.5-flash → 2.5,  gpt-5.6-luna → 5.6
_VERSION = re.compile(r"(\d+(?:\.\d+)?)")


def _bare(model_id: str) -> str:
    """제미나이는 'models/gemini-2.5-flash' 꼴로 준다. 앞머리를 뗀다."""
    return model_id.split("/", 1)[-1]


def _version(model_id: str) -> float:
    found = _VERSION.search(_bare(model_id))
    return float(found.group(1)) if found else 0.0


def is_chat_model(model_id: str) -> bool:
    """가사 정리에 쓸 수 있는 대화 모델인가."""
    name = _bare(model_id)
    return name.startswith(_CHAT_PREFIX) and not any(bad in name for bad in _NOT_CHAT)


def rank_models(rows: list[dict]) -> list[str]:
    """/models 응답 → 대화 모델만, 새것부터.

    created(발표 시각)가 있으면 그걸 믿고, 없으면 판번호로 가린다.
    """
    picked = [r for r in rows if is_chat_model(str(r.get("id", "")))]
    picked.sort(
        key=lambda r: (r.get("created") or 0, _version(str(r.get("id", "")))),
        reverse=True,
    )
    return [str(r["id"]) for r in picked]


def pick_model(models: list[str]) -> str:
    """목록에서 쓸 모델 하나 — 가장 새 것.

    날짜가 붙은 스냅샷은 건너뛴다. 같은 모델을 가리키면서 언젠가 사라지는
    이름이라, 날짜 없는 쪽을 두면 새 판이 나와도 그대로 따라간다.
    """
    stable = [m for m in models if not _SNAPSHOT.search(_bare(m))]
    return (stable or models or [""])[0]


# ── AI에게 가사를 물어보기 ────────────────────────────────────────
#
# 마지막 수단이다. 가사 데이터베이스에도 없고 자막도 없을 때만 쓴다.
#
# 알고 써야 할 것.
#   1. **대개 거부한다.** 실측: "이장희 그건 너"를 물으니 "저작권이 있는
#      노래 가사 전문은 제공할 수 없습니다", "안치환 사람이 꽃보다
#      아름다워"는 모른다고 답했다. 유명한 곡일수록 거부한다. 그래서 이
#      경로에 기대면 안 되고, 앞의 수단들이 먼저다.
#   2. 답하더라도 아는 대로 적는 것이라 틀릴 수 있다.
#   3. 줄이 언제 나오는지는 모델이 알 수 없다. 시각은 노래 길이에 고르게
#      나눠 붙인 어림값이다.

_LYRICS_PROMPT = """다음 곡의 가사를 알려주세요.

가수: {artist}
곡명: {title}

규칙:
- 가사 본문만 한 줄에 한 소절씩 적으세요.
- 번호, 굵은 글씨, [Verse]·[후렴] 같은 구조 표시는 넣지 마세요.
- 설명이나 머리말을 붙이지 마세요.
- 이 곡의 가사를 모르면 정확히 `MODR` 네 글자만 출력하세요. 절대
  지어내지 마세요. 비슷한 다른 곡의 가사를 적는 것이 가장 나쁩니다."""


def lyrics_text(artist: str, title: str) -> list[str]:
    """AI가 아는 이 곡의 가사. 모르면 빈 목록."""
    if not enabled() or not title:
        return []
    try:
        raw = _chat(_LYRICS_PROMPT.format(artist=artist or "(모름)", title=title))
    except Exception:
        return []

    lines = [line.strip() for line in raw.splitlines()]
    lines = [line for line in lines if line]
    if not lines or any(line.strip("`* ") == "MODR" for line in lines[:2]):
        return []
    # 거부 문구가 가사로 둔갑하지 않게 막는다. 모델은 시키는 형식을
    # 지키지 않고 사과문을 적는 일이 잦다.
    if _looks_like_refusal(lines):
        return []
    # 구조 표시가 섞여 오면 걷어낸다
    lines = [line for line in lines if not re.fullmatch(r"[\[(].{0,20}[\])]", line)]
    return lines[:200]


_REFUSAL = (
    "저작권", "제공할 수 없", "제공해 드릴 수 없", "도와드릴 수 없",
    "죄송", "알려드릴 수 없", "copyright", "can't provide", "cannot provide",
    "unable to provide", "sorry",
)


def _looks_like_refusal(lines: list[str]) -> bool:
    """가사 대신 거부·사과문이 왔는가.

    가사는 보통 여러 줄이고, 거부는 한두 줄이다. 앞 두 줄만 본다 —
    실제 가사에 "죄송"이 나오는 곡도 있는데 그건 첫 줄부터 나오지 않는다.
    """
    head = " ".join(lines[:2]).lower()
    return len(lines) <= 3 and any(word.lower() in head for word in _REFUSAL)


_QUERIES_PROMPT = """다음 곡을 해외 가사 데이터베이스에서 찾으려 합니다.
검색어 후보를 만들어 주세요.

가수: {artist}
곡명: {title}

규칙:
- 한 줄에 하나씩, 최대 6개.
- 로마자 표기를 여러 방식으로(띄어쓰기·하이픈 차이 포함) 넣으세요.
- 영어 번역 제목, 널리 쓰이는 다른 표기(예명·한자 표기)도 넣으세요.
- 설명 없이 검색어만 출력하세요."""


def more_queries(artist: str, title: str) -> list[str]:
    """가사를 못 찾았을 때 던져 볼 검색어를 더 만든다.

    한국 가요가 가사 데이터베이스에 어떤 표기로 올라 있는지는 곡마다
    다르다. 로마자 하나로는 자주 빗나가서, 여러 표기를 받아 훑는다.
    """
    if not enabled() or not title:
        return []
    try:
        raw = _chat(_QUERIES_PROMPT.format(artist=artist or "(모름)", title=title))
    except Exception:
        return []
    out = []
    for line in raw.splitlines():
        text = line.strip().lstrip("-*0123456789. ").strip()
        if text and len(text) < 80:
            out.append(text)
    return out[:6]


def spread_lines(lines: list[str], duration: float) -> list[dict]:
    """가사 줄을 노래 길이에 고르게 펴서 시각을 붙인다.

    시각을 모르는 가사(AI가 준 것, 동기화 안 된 가사)를 악보에 올리려면
    무엇이든 시각이 있어야 한다. 앞뒤로 전주·후주를 조금 비워 두고 나머지를
    고르게 나눈다 — 맞을 리는 없지만, 아예 못 붙이는 것보다 낫다.
    """
    if not lines:
        return []
    span_start = duration * 0.08 if duration else 0.0
    span_end = duration * 0.92 if duration else len(lines) * 4.0
    step = max((span_end - span_start) / len(lines), 0.5)
    out = []
    for i, text in enumerate(lines):
        start = round(span_start + i * step, 2)
        out.append({"t": start, "end": round(start + step, 2), "text": text})
    return out


# ── 자동 자막 다듬기 ──────────────────────────────────────────────
#
# 이건 LLM이 잘하는 일이다. 없는 가사를 지어내라는 것이 아니라, 이미
# 손에 있는 글을 고쳐 쓰는 일이기 때문이다.
#
# 실측(허만성 「우리 사랑 기억하겠네」 자동 자막 52줄):
#   "바라미 차가워진" → "바람이 차가워진"
#   "바람에 나연만이" → "바람에 낙엽만이"
#   "어둠속에 한줄기 미은" → "어둠 속에 한 줄기 빛은"
#   "그대 나의 마음 말아 주려는" → "그대 나의 마음 알아주려는"
#   토막 52줄 → 소절 25줄
#
# 다만 알아듣지 못한 구간은 그럴듯하게 메우기도 한다. 그래서 다듬은
# 가사에는 표시를 남기고, 화면에서 고칠 수 있게 해 둔다.

_TIDY_PROMPT = """다음은 노래 영상의 자동 자막입니다. 자동 인식이라 토막나 있고
글자가 틀립니다. 사람이 읽을 수 있는 가사로 다듬어 주세요.

규칙:
- 토막난 조각을 한 소절로 합치세요. 합친 줄의 시각은 **첫 조각의 시각**을 씁니다.
- 잘못 인식된 글자를 문맥에 맞게 고치세요(예: "바라미"→"바람이").
- **없는 내용을 지어내지 마세요.** 자막에 없는 소절은 넣지 않습니다. 알아듣기
  어려운 구간은 들리는 대로 두세요.
- 뜻이 없는 조각("k" 같은 것)은 버리세요.

JSON 배열만 출력하세요: [[시각, "가사"], ...]

자막:
{lines}"""


def tidy_lyrics(rows: list[dict]) -> list[dict]:
    """자동 자막을 읽을 만한 가사로 다듬는다. 실패하면 빈 목록.

    rows는 [{"t": 초, "text": "..."}]. 같은 모양으로 돌려준다.
    """
    if not enabled() or len(rows) < 2:
        return []

    joined = [str(row["t"]) + " " + str(row["text"]) for row in rows]
    lines = "\n".join(joined)
    try:
        raw = _chat(_TIDY_PROMPT.format(lines=lines))
    except Exception:
        return []

    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(raw[start : end + 1])
    except ValueError:
        return []

    out = []
    for item in data:
        if not isinstance(item, list) or len(item) < 2:
            continue
        try:
            t = float(item[0])
        except (TypeError, ValueError):
            continue
        text = str(item[1]).strip()
        if text:
            out.append({"t": round(t, 2), "text": text})
    out.sort(key=lambda r: r["t"])
    return out


# ── 붙여넣은 가사에 시각 붙이기 ────────────────────────────────────
#
# 사람이 웹에서 가사를 긁어 붙여넣으면 글자는 맞는데 시각이 없다. 노래
# 자리에 고르게 나눠 놓아 봐야 소절마다 어긋난다.
#
# 하지만 이 곡에는 이미 시각이 붙은 글이 있다 — 자동 자막이다. 글자는
# 틀려도 **언제 부르는지는 맞다**. 두 글을 나란히 놓고 "이 소절은 저
# 조각들에서 부르는 말"을 맞추는 일은 LLM이 잘하는 종류의 일이다.

_ALIGN_PROMPT = """아래 (가)는 이 노래의 자동 자막을 번호를 붙여 늘어놓은
것입니다. 글자는 틀릴 수 있지만 **언제 부르는지는 맞습니다**. (나)는 사람이
넣은 정확한 가사입니다.

(나)의 각 줄이 (가)의 몇 번 조각에서 시작하는지 찾아 주세요.

규칙:
- (나)의 줄을 **하나도 빼지 말고, 순서 그대로** 출력하세요.
- 번호는 (가)에 실제로 있는 번호만 씁니다. **새 숫자를 만들지 마세요.**
- 번호는 커지는 순서여야 합니다. 같은 번호를 두 번 쓰지 마세요.
- 자막의 글자가 틀려도 소리 나는 대로 읽어 맞춰 보세요
  ("나연만이"는 "낙엽만이", "미은"은 "빛은"입니다).

JSON 배열만 출력하세요. 줄 번호는 (나)의 순서, 값은 (가)의 조각 번호입니다:
[조각번호, 조각번호, ...]

(가) 자동 자막:
{captions}

(나) 정확한 가사:
{lyrics}"""


def align_lyrics(timed: list[dict], texts: list[str]) -> list[dict]:
    """붙여넣은 가사에 시각을 붙인다. 실패하면 빈 목록.

    timed는 [{"t": 초, "text": "..."}] (자막), texts는 정확한 가사 줄들.
    """
    if not enabled() or not texts or len(timed) < 2:
        return []

    captions = "\n".join(f"{i + 1}. {row['text']}" for i, row in enumerate(timed))
    lyrics = "\n".join(f"{i + 1}. {line}" for i, line in enumerate(texts))
    try:
        raw = _chat(_ALIGN_PROMPT.format(captions=captions, lyrics=lyrics))
    except Exception:
        return []

    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        picks = json.loads(raw[start : end + 1])
    except ValueError:
        return []
    if not isinstance(picks, list) or len(picks) != len(texts):
        return []

    # 시각은 우리가 정한다. 모델은 어느 조각인지만 고른다 — 시각까지 맡기면
    # 자막에 없는 숫자를 지어낸다(실측: 22.64, 29.74처럼 그럴듯하지만 자막
    # 어디에도 없는 값을 만들어 냈다).
    out: list[dict] = []
    last = -1
    for i, pick in enumerate(picks):
        try:
            idx = int(pick) - 1
        except (TypeError, ValueError):
            return []
        if not 0 <= idx < len(timed):
            return []
        # 순서가 뒤집히면 앞 줄 바로 다음 조각으로 민다
        idx = max(idx, last + 1)
        if idx >= len(timed):
            return []
        last = idx
        out.append({"t": round(float(timed[idx]["t"]), 2), "text": texts[i]})
    return out
