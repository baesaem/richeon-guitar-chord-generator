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


def times_from_score(align: dict, count: int) -> list[list[dict]] | None:
    """붙여 둔 악보(.mscz)의 정렬을 그대로 쓴다.

    마디 수가 다르면 쓰지 않는다 — 그림과 악보가 같은 판이 아니라는
    뜻이라, 억지로 맞추면 어긋난 채로 조용히 흘러간다.
    """
    passes = align.get("passes") or []
    if not passes:
        return None

    out: list[list[dict]] = []
    for p in passes:
        rows = p.get("bars") or []
        # 도돌이표를 편 정렬은 같은 마디가 여러 번 나온다. 그림은 마디마다
        # 자리가 하나뿐이라 그대로 얹을 수 없다 — 박 격자로 물러난다.
        if len({b["number"] for b in rows}) != len(rows):
            return None
        by_number = {b["number"]: b for b in rows}
        # 그림의 n번째 마디는 악보의 n번째 마디다. 번호로 짚는다.
        bars = []
        for i in range(1, count + 1):
            b = by_number.get(i)
            if b is None:
                return None
            bars.append({"start": b["start"], "end": b["end"]})
        out.append(bars)
    return out


def times_from_grid(
    result: dict, count: int, offset: float = 0.0, repeats: int = 1
) -> list[list[dict]]:
    """음원의 박 격자에 마디를 고르게 얹는다.

    offset은 악보 첫 마디를 음원의 몇 번째 마디에 놓을지다(소수 가능).
    되풀이하는 곡은 repeats만큼 이어 붙인다.
    """
    grid = Grid.of(result["beats"])
    try:
        per_bar = float(str(result.get("time_signature", "4/4")).split("/")[0])
    except ValueError:
        per_bar = 4.0
    per_bar = per_bar if per_bar > 0 else 4.0

    out: list[list[dict]] = []
    for r in range(max(repeats, 1)):
        base = (offset + r * count) * per_bar
        bars = []
        for i in range(count):
            start = grid.sec(base + i * per_bar)
            end = grid.sec(base + (i + 1) * per_bar)
            bars.append({"start": round(start, 3), "end": round(max(end, start + 0.05), 3)})
        out.append(bars)
    return out


def build(
    pages: list[Page],
    result: dict,
    align: dict | None,
    offset: float = 0.0,
    repeats: int = 1,
) -> dict:
    """앱으로 넘길 모양."""
    placed = flatten(pages)
    passes = None
    source = "grid"
    if align:
        passes = times_from_score(align, len(placed))
        if passes:
            source = "score"
    if passes is None:
        passes = times_from_grid(result, len(placed), offset, repeats)

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
        # 되풀이마다 마디별 시작·끝 시각
        "passes": passes,
        #: 시각을 어디서 얻었나 — "score"면 악보 파일의 정렬, "grid"면 박 격자
        "source": source,
        "offset": offset,
        "repeats": len(passes),
    }
