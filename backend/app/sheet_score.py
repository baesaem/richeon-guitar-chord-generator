"""악보 그림을 곡에 붙이고, 마디마다 시각을 준다.

우리가 음표를 그리는 것보다 **인쇄된 악보**가 낫다. 그래서 그림은
그대로 두고, 마디선만 찾아 그 위로 커서를 지나가게 한다.

시각을 주는 길은 둘이다.

1. 뮤즈스코어 파일(.mscz)이 함께 붙어 있으면 그 정렬을 그대로 쓴다.
   마디 수가 같으면 그림의 n번째 마디가 곧 악보의 n번째 마디다.
2. 그림뿐이면 음원의 박 격자에 고르게 얹는다. 어디서 시작하는지는
   강사님이 마디 하나만 짚어 주면 된다.
"""

from __future__ import annotations

from dataclasses import dataclass

from .score_align import Grid
from .sheet_layout import Page


@dataclass
class Placed:
    """그림 위의 마디 하나. 자리는 0~1 비율이라 화면 크기와 무관하다."""

    page: int
    system: int
    x0: float
    x1: float
    #: 오선 자체의 위·아래
    top: float
    bottom: float
    #: 화면에 잘라 보일 띠. 오선 위 코드와 아래 가사까지 담는다.
    view_top: float
    view_bottom: float


def flatten(pages: list[Page]) -> list[Placed]:
    """읽는 차례대로 마디를 편다 — 쪽·줄·왼쪽부터.

    잘라 보일 띠는 sheet_layout이 **실제로 빈 자리**를 찾아 정해 두었다.
    """
    out: list[Placed] = []
    for page in pages:
        for si, system in enumerate(page.systems):
            for x0, x1 in system.measures:
                out.append(
                    Placed(
                        page=page.index,
                        system=si,
                        x0=x0 / page.width,
                        x1=x1 / page.width,
                        top=system.top / page.height,
                        bottom=system.bottom / page.height,
                        view_top=system.view_top / page.height,
                        view_bottom=system.view_bottom / page.height,
                    )
                )
    return out


def times_from_score(align: dict, placed: list[Placed]) -> list[list[dict]] | None:
    """붙여 둔 악보(.mscz)의 정렬을 그림 위 마디에 잇는다.

    도돌이표를 편 정렬은 같은 마디가 여러 번 나온다. 그림에는 그 마디가
    한 자리뿐이지만 **되돌아가면 될 뿐이다** — 종이 악보를 보며 연주할
    때 D.S.를 만나면 사람도 그 마디로 되돌아간다. 그래서 마디를 버리지
    않고, 부르는 차례마다 「그림의 몇 번째 마디」를 가리키게 한다.
    """
    passes = align.get("passes") or []
    if not passes:
        return None

    # 그림의 마디 번호 → 그림에서 몇 번째 마디인가. 그림은 적힌 차례대로다.
    index_of = {i + 1: i for i in range(len(placed))}

    out: list[list[dict]] = []
    for p in passes:
        steps = []
        for b in p.get("bars") or []:
            at = index_of.get(b["number"])
            if at is None:
                return None
            steps.append({"bar": at, "start": b["start"], "end": b["end"]})
        if not steps:
            return None
        out.append(steps)
    return out


def times_from_grid(
    result: dict,
    count: int,
    offset: float = 0.0,
    repeats: int = 1,
    order: list[int] | None = None,
) -> list[list[dict]]:
    """음원의 박 격자에 마디를 고르게 얹는다.

    offset은 악보 첫 마디를 음원의 몇 번째 마디에 놓을지다(소수 가능).
    되풀이하는 곡은 repeats만큼 이어 붙인다.

    order를 주면 **부르는 차례**대로 얹는다. 도돌이표를 편 차례라
    같은 마디가 여러 번 나온다 — 적힌 대로 한 번씩만 얹으면 되돌이가
    있는 곡은 그 뒤로 죽 어긋난다.
    """
    grid = Grid.of(result["beats"])
    try:
        per_bar = float(str(result.get("time_signature", "4/4")).split("/")[0])
    except ValueError:
        per_bar = 4.0
    per_bar = per_bar if per_bar > 0 else 4.0

    walk = order if order else list(range(count))
    out: list[list[dict]] = []
    for r in range(max(repeats, 1)):
        base = (offset + r * len(walk)) * per_bar
        steps = []
        for k, bar in enumerate(walk):
            start = grid.sec(base + k * per_bar)
            end = grid.sec(base + (k + 1) * per_bar)
            steps.append({
                "bar": bar,
                "start": round(start, 3),
                "end": round(max(end, start + 0.05), 3),
            })
        out.append(steps)
    return out


def fit_offset(
    result: dict,
    sheet: dict,
    order: list[int] | None,
    around: float,
) -> float:
    """코드가 바뀌는 자리가 마디선과 가장 잘 맞도록 시작 마디를 다듬는다.

    반주는 대개 마디 첫머리에서 코드를 바꾼다. 그러니 「코드가 바뀐 시각」이
    마디선에 얼마나 가까운가를 재면, 악보를 얼마나 밀어야 하는지 알 수 있다.

    마디선으로는 한 마디 안의 자리만 가린다. 앞뒤 한 마디는 그림에서 읽은
    코드가 있을 때만 코드 이름으로 가리고, 그보다 멀리 옮기는 일은 사람이
    ◀ ▶로 정한다(가사를 봐야 알 수 있다).
    """
    changes = [c["start"] for c in result.get("chords") or [] if c.get("root")]
    if len(changes) < 8:
        return around
    count = len(sheet.get("bars") or [])
    if count < 2:
        return around

    best = (float("inf"), around)
    for step in range(-25, 26):
        offset = around + step / 50.0        # 0.02마디씩
        passes = times_from_grid(result, count, offset, 1, order)
        starts = [s["start"] for s in passes[0]]
        if not starts:
            continue
        span = passes[0][0]["end"] - passes[0][0]["start"] or 1.0
        total = 0.0
        n = 0
        for t in changes:
            if t < starts[0] or t > passes[0][-1]["end"]:
                continue
            near = min(starts, key=lambda s: abs(s - t))
            # 반 마디를 넘게 벌어진 것은 다른 마디의 일이다. 한도를 둔다.
            total += min(abs(near - t), span / 2)
            n += 1
        if n < 8:
            continue
        score = total / n
        if score < best[0]:
            best = (score, offset)
    offset = round(best[1], 2)
    # 마디선만 보면 한 마디 앞뒤를 가리지 못한다 — 마디선은 마디마다
    # 되풀이되니 4.5와 5.5가 똑같이 맞아 보인다. 찾는 폭의 끝에 정답이
    # 걸리면 한 마디 틀린 쪽을 골라, 「밤이 깊었네」는 누를 때마다 한 마디씩
    # 걸어가 악보 전체가 2초 밀렸다. 그림·악보에서 읽은 코드가 있으면
    # 코드 이름이 음원과 가장 많이 맞는 쪽을 고른다(비기면 그대로).
    rows = (sheet.get("read") or {}).get("chords") or []
    if rows:
        offset = _bar_by_chords(result, count, order, offset, rows)
    return offset


_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _pitch(name: str) -> int | None:
    """코드 이름의 뿌리음(0~11). 모르면 None."""
    if not name or name[0] not in _PC:
        return None
    pc = _PC[name[0]]
    if len(name) > 1 and name[1] in "#♯":
        pc += 1
    elif len(name) > 1 and name[1] in "b♭":
        pc -= 1
    return pc % 12


def _bar_by_chords(
    result: dict,
    count: int,
    order: list[int] | None,
    offset: float,
    rows: list[dict],
) -> float:
    """offset과 그 앞뒤 한 마디 가운데 코드 이름이 음원과 가장 많이 맞는 쪽."""
    by = {int(r.get("bar", 0)): (r.get("chords") or []) for r in rows}
    sheet_pc: dict[int, int | None] = {}
    cur: int | None = None
    for b in range(1, count + 1):
        if by.get(b):
            cur = _pitch(str(by[b][0]))
        sheet_pc[b] = cur
    audio = [c for c in result.get("chords") or [] if c.get("root")]

    def heard(t0: float, t1: float) -> int | None:
        best, got = 0.0, None
        for c in audio:
            ov = min(c["end"], t1) - max(c["start"], t0)
            if ov > best:
                best, got = ov, _pitch(str(c.get("label") or c.get("root") or ""))
        return got

    def agree(off: float) -> int:
        """이 자리에서 코드가 음원과 몇 마디 맞나 — 조를 옮겨 가장 잘 맞는 쪽.

        카포로 옮겨 적은 악보는 적힌 조와 울리는 조가 다르다(광화문 연가는
        Em으로 적고 G단조로 울린다). 이름을 그대로 견주면 한 번도 맞지 않아
        잡음만 보고 마디를 옮기게 된다.
        """
        steps = times_from_grid(result, count, off, 1, order)[0]
        pairs = [
            (sheet_pc.get(st["bar"] + 1), heard(st["start"], st["end"]))
            for st in steps
        ]
        pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
        return max(
            sum(1 for a, b in pairs if (a + t) % 12 == b) for t in range(12)
        )

    scores = {k: agree(offset + k) for k in (-1, 0, 1)}
    k = max(scores, key=scores.get)
    # 확실히 더 맞을 때만 옮긴다. 몇 마디 차이는 코드 인식의 잡음이다.
    if k != 0 and scores[k] >= scores[0] + 3:
        return round(offset + k, 2)
    return offset


def _order_of(score: dict | None, count: int) -> list[int] | None:
    """악보 파일이 아는 부르는 차례. 그림과 마디 수가 같을 때만 쓴다."""
    if not score:
        return None
    bars = score.get("bars") or []
    play = score.get("play") or []
    if len(bars) != count or len(play) <= count:
        return None
    return [i for i in play if 0 <= i < count]


def build(
    pages: list[Page],
    result: dict,
    align: dict | None,
    offset: float = 0.0,
    repeats: int = 1,
    order: list[int] | None = None,
    score: dict | None = None,
) -> dict:
    """앱으로 넘길 모양."""
    placed = flatten(pages)
    passes = None
    source = "grid"
    if align:
        passes = times_from_score(align, placed)
        if passes:
            source = "score"
    if passes is None:
        # 악보 파일에 가사가 없으면 정렬이 서지 않는다(정렬은 가사를
        # 표지 삼아 붙인다). 그래도 그 파일이 아는 것이 하나 있다 —
        # **도돌이표를 편 차례**다. 시각은 박 격자에서 얻고 차례만 빌린다.
        if order is None:
            order = _order_of(score, len(placed))
            if order:
                source = "repeat"
        elif order:
            source = "read"
        passes = times_from_grid(result, len(placed), offset, repeats, order)

    return {
        "pages": [
            {
                "index": p.index,
                "width": p.width,
                "height": p.height,
                # 쪽 여백을 뺀 가로 범위(0~1). 화면은 이만큼만 보여 준다.
                "left": round(p.crop_left / p.width, 5),
                "right": round((p.crop_right or p.width) / p.width, 5),
            }
            for p in pages
        ],
        "bars": [
            {
                "page": b.page,
                "system": b.system,
                "x0": round(b.x0, 5),
                "x1": round(b.x1, 5),
                "top": round(b.top, 5),
                "bottom": round(b.bottom, 5),
                "viewTop": round(b.view_top, 5),
                "viewBottom": round(b.view_bottom, 5),
            }
            for b in placed
        ],
        # 부르는 차례. 걸음마다 「그림의 몇 번째 마디」와 그 시각.
        # 도돌이표를 편 곡은 같은 마디가 여러 번 나온다.
        "passes": passes,
        #: 시각을 어디서 얻었나 — "score"면 악보 파일의 정렬,
        #: "read"면 AI가 그림에서 읽은 되돌이 차례, "grid"면 박 격자
        "source": source,
        "offset": offset,
        "repeats": len(passes),
        #: 부르는 차례(그림의 몇 번째 마디인지). AI가 읽었을 때만 담긴다
        **({"order": order} if order else {}),
    }
