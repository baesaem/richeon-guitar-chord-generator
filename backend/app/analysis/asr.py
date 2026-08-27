"""보컬 트랙 음성 인식(Whisper).

지금까지 가사는 웹(LRCLIB)이나 YouTube 자막에서 **찾아오기만** 했다. 그래서
자막 없는 곡은 빈손이고, 찾아온 가사의 시각도 자막 품질에 갇혀 있었다.

여기서는 Demucs가 이미 분리해 둔 보컬 트랙을 Whisper로 받아 적는다. 노래
자체가 원본이 되니 ① 자막 없는 곡도 가사가 생기고 ② 단어마다 실제로
부른 시각이 나와, 찾아온 가사의 줄 시각을 그 위에 다시 잴 수 있다.

받아 적은 글자는 틀릴 수 있다(발음이 뭉개지는 노래라 더). 그래서 글자는
웹에서 찾은 가사를 믿고, **시각만** 받아 적은 단어에서 가져온다 — 두 글을
문자 단위로 겹쳐 보고, 줄 머리가 닿는 단어의 시각을 쓴다.
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import asdict, dataclass
from threading import Lock

from ..config import settings
from ..schemas import LyricLine

# large-v3-turbo. 한국어 인식은 large-v3급인데 몇 배 빠르다.
MODEL_NAME = "turbo"

_model = None
_model_lock = Lock()


def _load():
    """모델은 한 번만 올린다. 처음 부를 때 가중치(~1.6GB)를 내려받는다."""
    global _model
    with _model_lock:
        if _model is None:
            import torch
            import whisper

            device = "cuda" if torch.cuda.is_available() else "cpu"
            _model = whisper.load_model(MODEL_NAME, device=device)
    return _model


@dataclass
class Word:
    """받아 적은 단어 하나와 부른 시각."""

    text: str
    start: float
    end: float


def _cache_path(audio_id: str):
    return settings.audio_dir / f"{audio_id}.words.json"


def transcribe_words(audio_id: str) -> list[Word]:
    """보컬 트랙을 단어 단위 시각과 함께 받아 적는다.

    분리 다음으로 느린 단계(GPU에서 수십 초)라 결과를 파일로 캐시한다.
    보컬 트랙이 없으면(분리 안 함) 빈 목록 — 부를 쪽에서 알아서 물러난다.
    """
    cache = _cache_path(audio_id)
    if cache.exists():
        try:
            return [Word(**w) for w in json.loads(cache.read_text("utf-8"))]
        except Exception:
            pass

    from .separate import vocals_path

    vocals = vocals_path(audio_id)
    if not vocals.exists():
        return []

    result = _load().transcribe(
        str(vocals),
        language="ko",
        word_timestamps=True,
        # 반주 구간에서 직전 가사를 되풀이하는 환각을 막는다. 문맥을 이어
        # 주면 정확도가 살짝 오르지만, 노래에서는 환각 쪽 손해가 훨씬 크다.
        condition_on_previous_text=False,
    )

    words: list[Word] = []
    for seg in result.get("segments", []):
        # 무음일 확률이 높은데 확신도 낮은 구간 — 간주에서 지어낸 말이다
        if seg.get("no_speech_prob", 0.0) > 0.6 and seg.get("avg_logprob", 0.0) < -1.0:
            continue
        for w in seg.get("words", []):
            text = str(w.get("word", "")).strip()
            if text:
                words.append(
                    Word(text, round(float(w["start"]), 2), round(float(w["end"]), 2))
                )

    cache.write_text(
        json.dumps([asdict(w) for w in words], ensure_ascii=False), "utf-8"
    )
    return words


# ---------------------------------------------------------------- 가사 만들기

_GAP = 1.2  # 이만큼 쉬면 소절이 끝난 것으로 본다
_MAX_CHARS = 30  # 화면 한 줄에 들어가는 길이


def lines_from_words(words: list[Word]) -> list[LyricLine]:
    """받아 적은 단어를 소절로 묶는다. 웹 어디에도 가사가 없을 때의 마지막 수단."""
    lines: list[LyricLine] = []
    cur: list[Word] = []

    def flush():
        if cur:
            lines.append(
                LyricLine(
                    t=cur[0].start,
                    end=cur[-1].end,
                    text=" ".join(w.text for w in cur),
                )
            )
            cur.clear()

    for w in words:
        if cur and (
            w.start - cur[-1].end > _GAP
            or sum(len(x.text) + 1 for x in cur) + len(w.text) > _MAX_CHARS
        ):
            flush()
        cur.append(w)
    flush()
    return lines


# ---------------------------------------------------------------- 시각 재기

_STRIP = re.compile(r"[^0-9a-z가-힣]+")


def _norm(s: str) -> str:
    return _STRIP.sub("", s.lower())


def align_with_asr(
    lines: list[LyricLine], words: list[Word]
) -> list[LyricLine] | None:
    """가사 줄 시각을 받아 적은 단어 시각으로 다시 잰다. 못 맞추면 None.

    두 글을 공백·기호를 걷어낸 문자열로 펴서 겹치는 구간을 찾고, 각 줄의
    머리글자가 닿은 단어의 시각을 그 줄의 시작으로 삼는다. 줄 머리가 몇
    글자 이상 어긋나면 그 줄은 건드리지 않는다 — 간주·후렴 반복에서
    엉뚱한 자리에 끌려가는 것보다 원래 시각이 낫다.
    """
    if len(lines) < 2 or len(words) < 10:
        return None

    # 받아 적은 글을 문자 스트림으로 편다. 문자마다 부른 시각을 기억한다.
    chars: list[tuple[str, float]] = []
    for w in words:
        for ch in _norm(w.text):
            chars.append((ch, w.start))
    asr = "".join(c for c, _ in chars)

    # 가사도 같은 방식으로 펴고, 줄마다 어디서 시작하는지 적어 둔다
    offsets: list[tuple[int, int]] = []
    parts: list[str] = []
    pos = 0
    for line in lines:
        n = _norm(line.text)
        offsets.append((pos, pos + len(n)))
        parts.append(n)
        pos += len(n)
    lyr = "".join(parts)
    if not lyr or not asr:
        return None

    blocks = [
        b
        for b in difflib.SequenceMatcher(None, lyr, asr, autojunk=False)
        .get_matching_blocks()
        if b.size >= 2
    ]
    # 받아 적은 글과 가사가 절반 가까이도 안 겹치면 서로 다른 노래다.
    # (다른 버전·다른 곡의 가사가 붙은 경우) 그때는 시각을 믿을 수 없다.
    if sum(b.size for b in blocks) < len(lyr) * 0.4:
        return None

    def start_at(s: int, e: int) -> float | None:
        """줄 [s, e) 의 머리와 겹치는 첫 문자의 시각."""
        slack = max(2, (e - s) // 3)  # 머리가 이만큼 넘게 어긋나면 포기
        for a, b, size in blocks:
            if a + size <= s:
                continue
            j = max(s, a)
            if j >= e or j - s > slack:
                break
            return chars[b + (j - a)][1]
        return None

    new_starts: list[float | None] = []
    for (s, e), line in zip(offsets, lines):
        t = start_at(s, e)
        # 짧은 줄(후렴 "피우길" 따위)은 같은 글자가 노래 곳곳에 있어
        # 엉뚱한 반복에 들러붙기 쉽다. 원래 시각이 있는 줄이 크게
        # 벗어나면 믿지 않는다 — 긴 줄은 매칭 자체가 증거라 제한 없다.
        if t is not None and line.t > 0 and (e - s) <= 6 and abs(t - line.t) > 10.0:
            t = None
        new_starts.append(t)
    if sum(t is not None for t in new_starts) < len(lines) // 2:
        return None

    # 못 맞춘 줄 채우기: 원래 시각이 매칭된 이웃 사이에 얌전히 들어가면
    # 그대로 쓰고(자막처럼 시각이 있던 글), 아니면 이웃 사이에 고르게
    # 놓는다(붙여넣기처럼 시각이 아예 없던 글).
    n = len(lines)
    i = 0
    while i < n:
        if new_starts[i] is not None:
            i += 1
            continue
        j = i
        while j < n and new_starts[j] is None:
            j += 1
        left = new_starts[i - 1] if i > 0 else 0.0
        right = new_starts[j] if j < n else None
        for k in range(i, j):
            orig = lines[k].t
            if orig > left and (right is None or orig < right):
                new_starts[k] = orig
            elif right is not None:
                frac = (k - i + 1) / (j - i + 1)
                new_starts[k] = left + (right - left) * frac
            else:
                new_starts[k] = left + 2.0 * (k - i + 1)
        i = j

    fixed: list[LyricLine] = []
    prev = -1.0
    for line, t in zip(lines, new_starts):
        start = round(max(float(t), prev + 0.01), 2)
        shift = start - line.t
        end = round(line.end + shift, 2) if line.end > line.t else line.end
        fixed.append(LyricLine(t=start, end=end, text=line.text))
        prev = start
    return fixed
