"""악보 그림에서 되돌이 표시를 AI로 읽는다.

악보 파일(.mscz·MusicXML)이 붙어 있으면 도돌이표도 D.S.도 글자로
적혀 있어 그냥 읽으면 된다. 그림뿐일 때가 문제다.

점 두 개(도돌이표)는 그림에서 찾을 수 있다 — 오선 가운데 두 칸에만
있어 자리표나 음표와 구별된다. 그러나 **1·2번 괄호의 숫자**와
**「D.S. al Coda」 같은 글자**는 모양 맞추기로는 읽지 못한다.

그래서 AI에게 보여 주고 읽게 한다. 우리가 찾아 둔 마디 번호를 그림
위에 적어 함께 보내는 것이 요령이다 — 「몇째 마디에 무엇이 있나」를
우리 번호로 답하게 해야, 답을 그대로 쓸 수 있다.

읽어 낸 것은 뮤즈스코어 파일과 같은 모양(ScoreBar)으로 바꾸어
score_file.expand에 넘긴다. 도돌이표를 펴는 셈법은 한 벌뿐이다.
"""

from __future__ import annotations

import base64
import io
import json
import urllib.request

from PIL import Image, ImageDraw

from .config import settings
from .runtime_config import llm_config
from .score_file import ScoreBar, expand

#: AI에게 보낼 그림의 긴 변. 원본(200dpi)은 한 쪽이 1653×2337이라
#: 그대로 보내면 무겁다. 마디 번호와 점 두 개가 보일 만큼만 줄인다.
_MAX_SIDE = 1400

_PROMPT = """이 악보 그림에서 **되돌아 부르는 표시**만 읽어 주세요.

그림 위에 빨간 상자와 번호가 찍혀 있습니다. 그 번호가 마디 번호입니다.
답은 반드시 그 번호로 해 주세요. 상자가 없는 곳은 셈에 넣지 마세요.

찾을 것:
- 도돌이표 𝄆(시작) 𝄇(끝) — 오선 가운데 두 칸에 점 두 개
- 1번·2번 괄호(볼타) — 오선 위에 꺾인 선과 작은 숫자.
  괄호가 **덮고 있는 마디만** 세세요. 대개 한두 마디입니다.
  1번 괄호 안에 끝 도돌이표 𝄇가 들어 있습니다.
  괄호에 「1.2.」처럼 숫자가 여럿이면 endings에 모두 적으세요: [1, 2]
- **가사가 몇 절인가**(verses) — 음표 아래 붙은 가사 줄을 세세요.
  「1. …」 「2. …」 「3. …」처럼 번호가 붙어 있거나, 한 음표 아래
  가사가 여러 줄로 겹쳐 적혀 있습니다. 줄 수가 곧 절 수입니다.
- 세뇨 𝄋 · 코다 𝄌 · Fine · To Coda
- D.S. al Coda, D.C. al Fine 같은 글자

**절 수와 되풀이 횟수는 같습니다.** 가사가 3절이면 그 대목을 세 번
부릅니다 — times는 3입니다(왕복 두 번). 2절이면 times는 2입니다.
「1번 괄호·2번 괄호」가 보인다고 무조건 두 번이 아닙니다. 절이 셋인데
괄호가 둘이면 첫 괄호를 1·2절에 부르고 마지막 괄호를 3절에 부릅니다.

JSON만 답하세요. 없는 항목은 빈 배열로 두세요.

{"verses": 절 수(가사 줄 수),
 "start_repeats": [마디번호...],
 "end_repeats": [{"bar": 마디번호, "times": 절 수}...],
 "voltas": [{"bar": 시작마디번호, "span": 덮는마디수, "endings": [1]}...],
 "markers": [{"bar": 마디번호, "label": "segno"}...],
 "jumps": [{"bar": 마디번호, "to": "segno", "until": "codab", "at": "coda"}...]}

label과 to/until/at은 다음 낱말만 씁니다:
  segno(𝄋) · coda(𝄌 코다 본문) · codab(To Coda 자리) · fine(Fine) · start(맨 처음)
D.S. al Coda는 {"to":"segno","until":"codab","at":"coda"}입니다.
D.C. al Fine은 {"to":"start","until":"fine","at":""}입니다.
"""


def _hint(pages) -> str:
    """그림에서 우리가 찾아 둔 도돌이표. AI에게 미리 일러 준다.

    점 두 개는 픽셀로도 꽤 잘 찾힌다. 「여기쯤에 있다」고 짚어 주면
    AI도 덜 흔들린다 — 같은 악보를 두 번 물었더니 답이 달랐다.
    """
    starts: list[int] = []
    ends: list[int] = []
    n = 0
    for page in pages:
        for system in page.systems:
            for i, side in system.repeats:
                # 마디선 i는 (n+i)번째 마디의 오른쪽 끝이다
                if side > 0:
                    starts.append(n + i + 1)
                else:
                    ends.append(n + i)
            n += len(system.measures)
    if not starts and not ends:
        return ""
    lines = ["", "그림을 재어 보니 아래에 점 두 개가 있었습니다.",
             "눈으로 확인하고, 맞으면 그대로 쓰고 틀렸으면 고쳐 주세요."]
    if starts:
        lines.append(f"  시작 도돌이표: {starts}번 마디쯤")
    if ends:
        lines.append(f"  끝 도돌이표: {ends}번 마디쯤")
    return chr(10).join(lines) + chr(10)


def _numbered(page, image: Image.Image, first: int) -> tuple[bytes, int]:
    """마디마다 번호를 적은 그림. (PNG, 다음 쪽 첫 번호)"""
    im = image.convert("RGB")
    draw = ImageDraw.Draw(im)
    n = first
    for system in page.systems:
        for a, b in system.measures:
            draw.rectangle(
                [a, system.view_top, b, system.view_bottom],
                outline=(255, 0, 0),
                width=3,
            )
            draw.text((a + 8, system.view_top + 6), str(n), fill=(220, 0, 0))
            n += 1
    if max(im.size) > _MAX_SIDE:
        scale = _MAX_SIDE / max(im.size)
        im = im.resize((int(im.width * scale), int(im.height * scale)))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue(), n


def _ask(images: list[bytes], hint: str = "") -> dict:
    """그림들을 한 번에 보여 주고 JSON을 받는다."""
    cfg = llm_config()
    if not cfg.get("api_key"):
        raise RuntimeError("AI 키가 없습니다. 설정에서 넣어 주세요.")

    content: list[dict] = [{"type": "text", "text": _PROMPT + hint}]
    for png in images:
        b64 = base64.b64encode(png).decode()
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
        )

    body = json.dumps(
        {"model": cfg["model"], "messages": [{"role": "user", "content": content}]}
    ).encode()
    req = urllib.request.Request(
        f"{cfg['base_url'].rstrip('/')}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        },
    )
    # 그림 여러 장을 보는 일이라 글자만 다룰 때보다 오래 걸린다
    with urllib.request.urlopen(req, timeout=max(settings.llm_timeout, 120)) as res:
        data = json.load(res)
    return _json(data["choices"][0]["message"]["content"])


def _json(raw: str) -> dict:
    """모델 답에서 JSON을 건져낸다. 코드 울타리를 붙여 오는 일이 있다."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("AI가 JSON으로 답하지 않았습니다.")
    out = json.loads(text[start : end + 1])
    if not isinstance(out, dict):
        raise ValueError("AI 답의 모양이 다릅니다.")
    return out


def to_bars(found: dict, count: int) -> list[ScoreBar]:
    """AI가 읽은 것을 마디 목록으로. 번호가 범위를 벗어나면 버린다."""

    def ok(n: object) -> int | None:
        try:
            i = int(n)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        return i if 1 <= i <= count else None

    bars = [ScoreBar(number=i + 1, beats=4.0) for i in range(count)]

    for n in found.get("start_repeats") or []:
        i = ok(n)
        if i:
            bars[i - 1].start_repeat = True

    # 가사 절 수 = 그 대목을 부르는 횟수. 3절이면 세 번(왕복 두 번)이다.
    try:
        verses = int(found.get("verses") or 0)
    except (TypeError, ValueError):
        verses = 0
    verses = verses if 2 <= verses <= 6 else 0

    for row in found.get("end_repeats") or []:
        i = ok(row.get("bar") if isinstance(row, dict) else row)
        if i:
            times = 2
            if isinstance(row, dict):
                try:
                    times = max(int(row.get("times", 2)), 2)
                except (TypeError, ValueError):
                    times = 2
            bars[i - 1].end_repeat = max(times, verses)

    for row in found.get("voltas") or []:
        if not isinstance(row, dict):
            continue
        i = ok(row.get("bar"))
        if not i:
            continue
        try:
            span = max(int(row.get("span", 1)), 1)
        except (TypeError, ValueError):
            span = 1
        endings = tuple(
            int(e) for e in (row.get("endings") or []) if str(e).strip().isdigit()
        )
        bars[i - 1].volta = (endings, span)

    for row in found.get("markers") or []:
        if not isinstance(row, dict):
            continue
        i = ok(row.get("bar"))
        label = str(row.get("label") or "").strip()
        if i and label:
            bars[i - 1].markers = tuple([*bars[i - 1].markers, label])

    for row in found.get("jumps") or []:
        if not isinstance(row, dict):
            continue
        i = ok(row.get("bar"))
        if not i:
            continue
        bars[i - 1].jump = (
            str(row.get("to") or "").strip(),
            str(row.get("until") or "").strip(),
            str(row.get("at") or "").strip(),
        )

    _fix_voltas(bars)
    # 다카포는 「맨 처음으로」다. 첫 마디에 이정표를 세워 둔다.
    bars[0].markers = tuple(["start", *bars[0].markers])
    return bars


def _fix_voltas(bars: list[ScoreBar]) -> None:
    """1번 괄호의 자리를 되돌이표에 맞춰 바로잡는다.

    1번 괄호는 **끝 도돌이표를 품고** 있어야 한다 — 그것이 괄호의 뜻이다.
    첫 바퀴에 여기를 부르고, 되돌아온 다음 바퀴에는 건너뛰어 2번 괄호로
    간다. AI가 괄호의 시작을 되돌이 구간 첫머리로 잘못 짚으면(실제로
    그런다) 두 번째 바퀴가 통째로 날아가 되돌이가 없는 것과 같아진다.

    2번 괄호의 길이를 자로 삼는다. 두 괄호는 대개 같은 길이다.

    괄호가 **몇 바퀴째를 맡는가**도 되풀이 횟수에 맞춘다. 가사가 3절인
    악보는 첫 괄호에 「1.2.」, 마지막 괄호에 「3.」이 적힌다. 이것을
    1번·2번으로 읽어 두면 셋째 바퀴에 부를 괄호가 없어져, 노래가 2절에서
    끝나 버린다.
    """
    ends = [i for i, b in enumerate(bars) if b.end_repeat]
    if not ends:
        return
    for end in ends:
        # 괄호가 없는 악보에 괄호를 만들어 붙이면 안 된다 — 마지막
        # 바퀴에서 멀쩡한 마디 하나가 통째로 빠진다. 이 되돌이 언저리에
        # AI가 본 괄호가 있을 때만 자리를 바로잡는다.
        near = [
            i
            for i in range(max(end - 4, 0), min(end + 4, len(bars)))
            if bars[i].volta
        ]
        if not near:
            continue
        turns = bars[end].end_repeat          # 이 대목을 부르는 횟수
        second = next(
            (
                i
                for i in range(end + 1, min(end + 3, len(bars)))
                if bars[i].volta
            ),
            None,
        )
        span = bars[second].volta[1] if second is not None else 1
        span = max(min(span, 4), 1)
        first = max(end - span + 1, 0)
        # 되돌이 구간 안에 있던 앞 괄호는 지우고 제자리에 다시 세운다
        for i, b in enumerate(bars):
            if b.volta and i <= end:
                b.volta = None
        # 앞 괄호는 마지막 바퀴를 뺀 모든 바퀴, 뒤 괄호는 마지막 바퀴
        bars[first].volta = (tuple(range(1, turns)), span)
        if second is not None:
            bars[second].volta = ((turns,), bars[second].volta[1])


def read(pages, images: list[bytes]) -> dict:
    """악보 그림을 AI에게 읽히고, 부르는 차례를 만든다.

    돌려주는 것:
      order  — 부르는 차례(그림의 몇 번째 마디인지, 0부터)
      found  — AI가 읽은 것 그대로. 화면에 무엇을 찾았는지 보여 준다.
    """
    shots: list[bytes] = []
    first = 1
    for page, raw in zip(pages, images):
        png, first = _numbered(page, Image.open(io.BytesIO(raw)), first)
        shots.append(png)
    count = first - 1
    if count < 2:
        raise ValueError("마디를 찾지 못한 악보입니다.")

    found = _ask(shots, _hint(pages))
    bars = to_bars(found, count)
    order = expand(bars)
    if not order:
        raise ValueError("부르는 차례를 만들지 못했습니다.")
    return {"order": order, "found": found, "bars": count}
