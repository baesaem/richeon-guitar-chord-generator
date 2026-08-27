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
import urllib.error
import urllib.request

from .config import settings
from .runtime_config import llm_config


class SongInfo:
    """제목에서 뽑아낸 곡 정보."""

    def __init__(self, artist: str = "", title: str = "", romanized: list[str] | None = None):
        self.artist = artist
        self.title = title
        self.romanized = romanized or []

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

JSON만 출력하세요. 설명을 붙이지 마세요.
{{"artist": "...", "title": "...", "romanized": ["가수 곡명 로마자", "곡명 영문 번역"]}}"""


def _chat(prompt: str) -> str:
    """OpenAI 호환 chat completions 호출. 실패하면 예외."""
    cfg = llm_config()
    body = json.dumps(
        {
            "model": cfg["model"],
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
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
    roman = data.get("romanized") or []
    if isinstance(roman, str):
        roman = [roman]
    return SongInfo(
        artist=str(data.get("artist") or "").strip(),
        title=str(data.get("title") or "").strip(),
        romanized=[str(r).strip() for r in roman if str(r).strip()],
    )


def enabled() -> bool:
    return bool(llm_config()["api_key"])


def song_info(video_title: str) -> SongInfo | None:
    """영상 제목 → 가수·곡명·로마자. 키가 없거나 실패하면 None."""
    if not enabled() or not video_title.strip():
        return None
    try:
        return _parse(_chat(_PROMPT.format(title=video_title)))
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError):
        # 가사는 부가 기능이다. LLM이 죽어도 분석은 그대로 간다.
        return None
