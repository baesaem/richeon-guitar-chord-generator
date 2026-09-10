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
    # 줄의 첫 마디는 오선 왼쪽 끝부터 상자를 친다. 첫 마디선을 조표 뒤에서
    # 찾은 줄은 상자가 조표 뒤에서 시작해, 그 바로 앞에 인쇄된 첫 코드가
    # 상자 밖(또는 상자 선 밑)에 깔려 AI가 어느 마디 것인지 몰랐다 —
    # 「밤이 깊었네」 38·60·64마디의 D가 그렇게 빠졌다. 그림에만 칠 뿐
    # 마디 자리는 그대로다.
    left = min((s.measures[0][0] for s in page.systems if s.measures), default=0)
    for system in page.systems:
        for k, (a, b) in enumerate(system.measures):
            if k == 0:
                a = min(a, left)
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


#: 되돌이표에 더해 **코드 이름**까지 읽게 하는 덧붙임. 종이 악보로 등록한
#: 곡의 코드가 악보를 따르려면 마디마다 무슨 코드가 적혀 있는지 알아야
#: 한다. 음표는 읽히지 않는다 — 전에 재어 보니 하나도 맞지 않았다.
#: 코드 글자와 마디 번호는 잘 읽는다.
_CHORD_ADDON = """
그리고 **코드 이름**도 읽어 주세요. 오선 위에 적힌 글자(C, Am7, G/B, F#m 같은 것)입니다.
마디마다 그 마디 안에 적힌 코드를 **왼쪽부터 차례로** 적으세요. 코드 글자가
없는 마디는 적지 마세요(앞 코드가 이어집니다). 적힌 그대로 옮기고 바꾸지 마세요.
조표를 보고 조도 적어 주세요(예: "G", "Em", "Bb").

위 JSON에 다음 두 항목을 더하세요:
 "key": "조",
 "chords": [{"bar": 마디번호, "chords": ["C", "G7"]}...]
"""


def _ask(images: list[bytes], hint: str = "", prompt: str | None = None) -> dict:
    """그림들을 한 번에 보여 주고 JSON을 받는다."""
    cfg = llm_config()
    if not cfg.get("api_key"):
        raise RuntimeError("AI 키가 없습니다. 설정에서 넣어 주세요.")

    content: list[dict] = [{"type": "text", "text": (prompt or _PROMPT) + hint}]
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
    starts = [i for i, b in enumerate(bars) if b.start_repeat]
    for end in ends:
        turns = bars[end].end_repeat
        begin = max([s for s in starts if s <= end], default=0)
        second = next(
            (i for i in range(end + 1, min(end + 3, len(bars))) if bars[i].volta),
            None,
        )
        # AI가 이 되돌이 구간 안에 짚은 1번 괄호. 되돌이 **시작 마디나 그
        # 바로 뒤**에 짚였으면 잘못 짚은 것이다 — 아래 옛 규칙으로 옮긴다.
        # 그보다 뒤에 짚였으면 그 자리를 믿는다. 거기서부터 끝 도돌이까지가
        # 「첫 바퀴에만 부르는 곳」이다. 괄호 선이 짧게 닫혀 있어도(겹세로줄
        # 에서 닫고 후렴을 한참 이어 가는 판) 두 번째 바퀴는 거기서 2번
        # 괄호로 건너뛴다 — 「밤이 깊었네」는 41마디의 1번 괄호를 58마디로
        # 옮겨 후렴을 한 번 더 불렀고, 「광화문 연가」는 11~12마디 괄호를
        # 12마디 하나로 줄여 11마디를 한 번 더 불렀다.
        firsts = [i for i in range(begin, end + 1) if bars[i].volta]
        trusted = next((i for i in firsts if i > begin + 1), None)
        if trusted is not None:
            for i in firsts:
                if i != trusted:
                    bars[i].volta = None
            bars[trusted].volta = (tuple(range(1, turns)), end - trusted + 1)
            if second is not None:
                bars[second].volta = ((turns,), bars[second].volta[1])
            continue
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


# ── 종이 악보의 코드 → ABC ─────────────────────────────────────────

_MARK = {"segno": "!segno!", "coda": "!coda!", "codab": '"To Coda"', "fine": "!fine!"}
_JUMP = {
    ("segno", "codab", "coda"): "!D.S.alcoda!",
    ("segno", "fine", ""): "!D.S.alfine!",
    ("start", "fine", ""): "!D.C.alfine!",
    ("start", "codab", "coda"): "!D.C.alcoda!",
}
_CHORD_RE = r"^[A-G][#b]?[A-Za-z0-9+#b()]*(/[A-G][#b]?)?$"


def to_abc(found: dict, count: int, title: str = "") -> str:
    """AI가 읽은 코드와 되돌이표로 **코드만 적힌** ABC를 만든다.

    음표는 없다 — 마디마다 쉼표로 채우고 코드 글자만 얹는다. 앱의 「악보
    따르기」는 마디 수와 마디마다의 코드만 보므로 이것으로 넉넉하다.
    되돌이표·괄호·세뇨·코다는 그대로 옮겨 부르는 차례가 펴지게 한다.
    """
    import re

    bars = to_bars(found, count)
    per: dict[int, list[str]] = {}
    for row in found.get("chords") or []:
        if not isinstance(row, dict):
            continue
        try:
            i = int(row.get("bar"))
        except (TypeError, ValueError):
            continue
        names = [
            str(c).strip().replace("♯", "#").replace("♭", "b")
            for c in (row.get("chords") or [])
        ]
        names = [c for c in names if re.match(_CHORD_RE, c)]
        if 1 <= i <= count and names:
            per[i] = names[:4]

    key = str(found.get("key") or "C").strip().replace("♯", "#").replace("♭", "b")
    if not re.match(r"^[A-G][#b]?m?$", key):
        key = "C"

    # 한 마디는 8분음표 여덟 개. 코드 수대로 나눈다
    split = {1: [8], 2: [4, 4], 3: [3, 3, 2], 4: [2, 2, 2, 2]}
    out: list[str] = []
    line: list[str] = []
    for b in bars:
        t = ""
        if b.start_repeat:
            t += "|: "
        if b.volta:
            t += "[" + ",".join(str(e) for e in b.volta[0]) + " "
        for m in b.markers:
            if m in _MARK:
                t += _MARK[m]
        if b.jump and tuple(b.jump) in _JUMP:
            t += _JUMP[tuple(b.jump)]
        names = per.get(b.number)
        if names:
            lens = split[len(names)]
            t += " ".join(f'"{c}" z{n}' for c, n in zip(names, lens))
        else:
            t += "z8"
        t += " :|" if b.end_repeat else " |"
        line.append(t)
        if len(line) == 4:
            out.append(" ".join(line))
            line = []
    if line:
        out.append(" ".join(line))
    head = ["X:1", f"T:{title or '악보'}", "M:4/4", "L:1/8", f"K:{key}"]
    return chr(10).join(head + out) + chr(10)


def read_chords(pages, images: list[bytes], title: str = "") -> dict:
    """되돌이표와 코드를 한 번에 읽어, 부르는 차례와 코드 ABC를 낸다."""
    shots: list[bytes] = []
    first = 1
    for page, raw in zip(pages, images):
        png, first = _numbered(page, Image.open(io.BytesIO(raw)), first)
        shots.append(png)
    count = first - 1
    if count < 2:
        raise ValueError("마디를 찾지 못한 악보입니다.")

    found = _ask(shots, _hint(pages), prompt=_PROMPT + _CHORD_ADDON)
    bars = to_bars(found, count)
    order = expand(bars)
    if not order:
        raise ValueError("부르는 차례를 만들지 못했습니다.")
    read_n = len([r for r in (found.get("chords") or []) if isinstance(r, dict)])
    return {
        "order": order,
        "found": found,
        "bars": count,
        "abc": to_abc(found, count, title),
        "chord_bars": read_n,
    }


# ── 그림 악보의 타브를 AI로 읽기 ──────────────────────────────────

_TAB_PROMPT = """이 악보 그림에서 **타브(TAB) 여섯 줄에 적힌 프렛 숫자**를 읽어 주세요.

그림 위에 빨간 상자와 번호가 찍혀 있습니다. 그 번호가 마디 번호입니다.

타브는 왼쪽에 「TAB」이라고 적힌 여섯 줄짜리 보표입니다. 오선(음표가 있는
보표)이 아니라 **숫자가 적힌 여섯 줄**을 읽으세요. 없으면 빈 배열로 두세요.

읽는 법:
- **맨 윗줄이 1번 줄**(가장 가는 줄), 맨 아랫줄이 6번 줄입니다.
- 왼쪽에서 오른쪽으로, 세로로 같은 자리에 있는 숫자는 **함께 짚는 것**입니다.
- 한 자리를 "프렛/줄"로 적습니다. 3번 프렛을 1번 줄에서 짚으면 "3/1"입니다.
- 함께 짚는 것은 붙여 씁니다: "3/1 3/6" 처럼 한 칸 띄어 차례로.
  같은 자리에 둘 이상이면 그 자리들을 **+**로 묶습니다: "3/1+3/6"
- 개방현은 0입니다. 빗금(∕)만 있고 숫자가 없는 자리는 적지 마세요.

보기: 마디에 「1번 줄 3 · 6번 줄 3」이 함께, 그다음 「4번 줄 0」, 그다음
「3번 줄 0」이 있으면  →  "3/1+3/6 0/4 0/3"

**코드 이름도 함께 읽어 주세요.** 보표 위(또는 아래)에 적힌 Em, B7,
G/B 같은 글자입니다. 그 마디에 적힌 것을 왼쪽에서 오른쪽 차례로 담고,
없으면 빈 배열로 두세요.

**가사도 함께 읽어 주세요.** 오선 아래에 음표마다 한 글자씩 적힌 말입니다.
그 마디 아래에 적힌 것만, 왼쪽에서 오른쪽 차례로 **띄어 쓴 그대로** 담으세요.
가사가 위아래 두 줄이면 윗줄이 1절("lyric"), 아랫줄이 2절("lyric2")입니다.
한 줄뿐이면 1절만 담고 2절은 빈 문자열로 두세요. 가사가 없는 마디는
둘 다 빈 문자열입니다. **없는 말을 지어내지 마세요** — 안 보이면 비웁니다.

JSON만 답하세요. 못 읽은 마디는 넣지 마세요.

{"tab": [{"bar": 마디번호, "cols": "3/1+3/6 0/4 0/3", "chords": ["Em","B7"],
          "lyric": "모 두 들", "lyric2": "어 제 는"}, ...]}
"""


def read_tab_ai(pages, images: list[bytes]) -> dict:
    """그림 악보의 타브와 **코드 이름과 가사**를 한 번에 읽힌다.

    따로 물으면 AI를 여러 번 부르게 되고, 그 사이에 마디 번호가 어긋날
    수도 있다. 한 그림을 한 번 보여 주고 셋을 함께 받는다.

    가사도 그림에서 온다. 뮤즈스코어 파일로 뜬 타브는 노래 보표에서
    가사를 함께 떠 오지만, 멜로디까지 그림인 곡은 가사가 어디에도
    적혀 있지 않다 - 그림에는 인쇄돼 있으니 거기서 읽는다.
    """
    import re

    shots: list[bytes] = []
    first = 1
    for page, raw in zip(pages, images):
        png, first = _numbered(page, Image.open(io.BytesIO(raw)), first)
        shots.append(png)
    count = first - 1
    if count < 2:
        raise ValueError("마디를 찾지 못한 악보입니다.")

    found = _ask(shots, prompt=_TAB_PROMPT)
    per: dict[int, list[dict[str, int]]] = {}
    names: dict[int, list[str]] = {}
    words: dict[int, tuple[str, str]] = {}
    for row in found.get("tab") or []:
        if not isinstance(row, dict):
            continue
        try:
            i = int(row.get("bar"))
        except (TypeError, ValueError):
            continue
        if not 1 <= i <= count:
            continue
        cols: list[dict[str, int]] = []
        for token in str(row.get("cols") or "").split():
            col: dict[str, int] = {}
            for one in token.split("+"):
                m = re.fullmatch(r"(\d{1,2})/([1-6])", one.strip())
                if not m:
                    continue
                fret, string = int(m.group(1)), int(m.group(2))
                if 0 <= fret <= 24:
                    col[str(string)] = fret
            if col:
                cols.append(col)
        if cols:
            per[i] = cols
        got = [str(c).strip() for c in (row.get("chords") or []) if str(c).strip()]
        if got:
            names[i] = got[:4]
        one = str(row.get("lyric") or "").strip()
        two = str(row.get("lyric2") or "").strip()
        if one or two:
            words[i] = (one[:40], two[:40])

    measures: list[dict] = []
    for i in range(1, count + 1):
        one: dict = {"no": i, "kind": "pick", "cols": per.get(i, [])}
        if names.get(i):
            one["chords"] = names[i]
        if words.get(i):
            one["lyric"], one["lyric2"] = words[i]
        measures.append(one)
    return {
        "bar_offset": 0,
        "measures": measures,
        "chord_bars": len(names),
        "lyric_bars": len(words),
        "unread": sum(1 for m in measures if not m["cols"]),
    }
