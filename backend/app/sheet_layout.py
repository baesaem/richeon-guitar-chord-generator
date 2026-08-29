"""악보 그림에서 오선 묶음과 마디선을 찾는다.

음표를 읽어내려는 것이 아니다(그건 정확도가 낮다). **줄과 세로선만**
찾는다 — 인쇄된 악보는 선이 곧고 검어서 이것만은 잘 잡힌다.

찾아 두면 진짜 악보 그림 위로 커서를 지나가게 할 수 있다. 우리가 그린
음표보다 인쇄된 악보가 낫다는 것이 이 방식의 요지다.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

#: 잉크로 볼 밝기의 후보. 악보마다 선의 짙기가 다르다 —
#: 뮤즈스코어는 새까맣고, 인쇄용으로 만든 타브 악보는 옅은 회색이다.
_INK_STEPS = (120, 150, 175, 195, 210)
#: 가로줄로 치려면 이 정도는 폭을 채워야 한다
_LINE_FILL = 0.45
#: 세로선으로 치려면 오선 높이의 이만큼을 채워야 한다.
#:
#: 두 악보를 재어 보니 갈리는 자리가 뚜렷했다. 진짜 마디선은 오선을
#: 빈틈없이(1.000) 꿰고, 음표 기둥과 타브의 이음줄은 0.89~0.97에서
#: 멈춘다. 머리나 숫자에 한 번은 가리기 때문이다.
#:
#: 0.97로 두었더니 200dpi에서 폭 1픽셀·채움 0.974짜리가 끼어들어 마디가
#: 58개가 되었고, 악보 파일과 마디 수가 달라 정렬이 조용히 버려졌다.
#: 빈틈이 하나도 없을 것을 요구한다.
_BAR_FILL = 0.995


@dataclass
class System:
    """오선(또는 타브) 한 묶음. 악보 한 줄이다."""

    top: int
    bottom: int
    #: 줄 개수. 5면 오선, 6이면 타브
    lines: int
    #: 마디선의 x 자리(왼쪽부터)
    bars: list[int] = field(default_factory=list)
    #: 화면에 잘라 보일 띠. 이 줄에 딸린 코드와 가사까지 담는다.
    view_top: int = 0
    view_bottom: int = 0
    #: 도돌이표로 보이는 마디선의 자리(bars에서 몇 번째인가)와 방향.
    #: +1이면 시작 𝄆(점이 오른쪽), -1이면 끝 𝄇(점이 왼쪽).
    repeats: list[tuple[int, int]] = field(default_factory=list)
    #: 우리가 넣어 준 경계인가(인쇄된 마디선이 아니라). 도돌이표를
    #: 찾을 때 건너뛴다 — 우리가 그은 자리에 점이 있을 리 없다.
    made_start: bool = False
    made_end: bool = False
    #: 2단 악보에서 이 줄에 딸린 **아래 단**의 오선 윗자리.
    #: 위 단만 쓰되, 화면에 잘라 보일 때 아래 단을 물지 않게 하는 데 쓴다.
    pair_top: int | None = None

    @property
    def measures(self) -> list[tuple[int, int]]:
        """마디의 (왼쪽, 오른쪽). 세로선 사이가 한 마디다."""
        return list(zip(self.bars, self.bars[1:]))


@dataclass
class Page:
    index: int
    width: int
    height: int
    systems: list[System] = field(default_factory=list)
    #: 악보가 실제로 그려진 가로 범위. 쪽 여백을 잘라 내면 그만큼 크게 보인다.
    crop_left: int = 0
    crop_right: int = 0


def _gray(img: Image.Image) -> np.ndarray:
    """회색조 판. 색·투명도는 흰 바탕에 얹어 없앤다."""
    if img.mode in ("RGBA", "LA", "P"):
        flat = Image.new("RGB", img.size, "white")
        flat.paste(img, mask=img.convert("RGBA").split()[-1])
        img = flat
    return np.asarray(img.convert("L"), dtype=np.uint8)


def _ink(gray: np.ndarray) -> np.ndarray:
    """잉크면 True인 판.

    짙기를 하나로 못 박을 수 없다. 뮤즈스코어 악보는 선이 새까맣지만,
    인쇄용으로 만든 타브 악보는 옅은 회색이라 같은 잣대로는 한 줄도
    못 찾는다. 가로줄이 가장 잘 잡히는 짙기를 골라 쓴다.
    """
    best, score = None, -1.0
    for thr in _INK_STEPS:
        ink = gray < thr
        # 온통 검어지는 짙기는 버린다
        if ink.mean() > 0.25:
            continue
        rows = ink.sum(axis=1) / float(ink.shape[1])
        found = int((rows > _LINE_FILL).sum())
        if found > score:
            best, score = ink, found
    return best if best is not None else (gray < _INK_STEPS[0])


def _runs(flags: np.ndarray, gap: int = 2) -> list[tuple[int, int]]:
    """True가 이어지는 구간. gap만큼 끊긴 것은 이어 붙인다."""
    idx = np.flatnonzero(flags)
    if idx.size == 0:
        return []
    out: list[list[int]] = [[int(idx[0]), int(idx[0])]]
    for i in idx[1:]:
        if i - out[-1][1] <= gap:
            out[-1][1] = int(i)
        else:
            out.append([int(i), int(i)])
    return [(a, b) for a, b in out]


def find_systems(ink: np.ndarray) -> list[System]:
    """가로줄을 찾아 묶음으로 나눈다."""
    h, w = ink.shape
    rows = ink.sum(axis=1) / float(w)
    lines = _runs(rows > _LINE_FILL, gap=1)
    if not lines:
        return []

    # 줄 사이 간격을 재어, 그보다 훨씬 벌어지면 다른 묶음으로 본다
    mids = [(a + b) / 2 for a, b in lines]
    gaps = sorted(b - a for a, b in zip(mids, mids[1:])) or [0]
    step = gaps[len(gaps) // 2] or 1

    groups: list[list[tuple[int, int]]] = [[lines[0]]]
    for prev, cur in zip(lines, lines[1:]):
        if (cur[0] + cur[1]) / 2 - (prev[0] + prev[1]) / 2 > step * 2.2:
            groups.append([cur])
        else:
            groups[-1].append(cur)

    out: list[System] = []
    for g in groups:
        # 줄이 넷 미만이면 오선이 아니다(표 테두리·밑줄 따위)
        if len(g) < 4:
            continue
        out.append(System(top=g[0][0], bottom=g[-1][1], lines=len(g)))
    return out


def find_bars(ink: np.ndarray, system: System) -> list[int]:
    """묶음 안에서 세로줄(마디선)을 찾는다."""
    band = ink[system.top : system.bottom + 1, :]
    height = max(band.shape[0], 1)
    cols = band.sum(axis=0) / float(height)
    # 맨 윗줄과 맨 아랫줄에 모두 닿아야 마디선이다. 음표 기둥은 오선
    # 한가운데를 지날 뿐 위아래를 꿰지 않는다.
    edge = max(height // 12, 1)
    touches = band[:edge, :].any(axis=0) & band[-edge:, :].any(axis=0)
    hits = _runs((cols > _BAR_FILL) & touches, gap=2)
    if not hits:
        return []

    # 겹줄(겹세로줄·되돌이표)은 하나로 본다
    bars: list[int] = []
    for a, b in hits:
        x = (a + b) // 2
        if bars and x - bars[-1] < height * 0.35:
            continue
        bars.append(x)
    return bars


def _dot_rows(lines: int) -> tuple[tuple[float, float], tuple[float, float]]:
    """도돌이표 점이 앉는 칸과, 견줄 바깥 칸. (칸 번호는 0.5 단위)

    오선(5줄)은 가운데 두 칸에 점을 찍는다. 타브(6줄)는 칸이 다섯이라
    가운데를 비우고 둘째·넷째 칸에 찍는다. 줄 수에 따라 자리가 다르다.
    """
    spaces = max(lines - 1, 2)
    mid = spaces / 2.0
    if spaces % 2 == 0:
        dots = (mid - 0.5, mid + 0.5)
    else:
        dots = (mid - 1.0, mid + 1.0)
    return dots, (0.5, spaces - 0.5)


def _dot_ink(ink: np.ndarray, system: System, x: int, side: int) -> tuple[float, float]:
    """마디선 옆 칸들의 잉크. (점이 앉을 칸, 그 바깥 칸)"""
    spaces = max(system.lines - 1, 2)
    space = (system.bottom - system.top) / float(spaces)
    lo = int(x + 3) if side > 0 else int(x - space * 1.5)
    hi = int(x + space * 1.5) if side > 0 else int(x - 3)
    lo, hi = max(lo, 0), min(hi, ink.shape[1] - 1)
    if hi - lo < 3:
        return 0.0, 1.0

    def mean_at(k: float) -> float:
        y = k * space
        a, b = int(y - space * 0.3), int(y + space * 0.3)
        win = ink[system.top + max(a, 0) : system.top + b + 1, lo:hi]
        return float(win.mean()) if win.size else 0.0

    dots, outer = _dot_rows(system.lines)
    return (
        (mean_at(dots[0]) + mean_at(dots[1])) / 2,
        (mean_at(outer[0]) + mean_at(outer[1])) / 2,
    )


def find_repeats(ink: np.ndarray, system: System) -> list[tuple[int, int]]:
    """도돌이표(점 두 개)가 붙은 마디선을 찾는다.

    점은 오선 **가운데 두 칸**에만 있다. 자리표나 음표는 위아래 칸까지
    채우므로 그것으로 가린다. 줄 첫머리 경계는 자리표가 붙어 있어
    보지 않는다 — 거기 도돌이표가 있어도 우리가 넣은 경계일 뿐이다.
    """
    out: list[tuple[int, int]] = []
    last = len(system.bars) - 1
    for i, x in enumerate(system.bars):
        # 우리가 넣은 경계는 건너뛴다. 인쇄된 선에만 점이 붙는다.
        if (i == 0 and system.made_start) or (i == last and system.made_end):
            continue
        for side in (-1, 1):
            mid, outer = _dot_ink(ink, system, x, side)
            if mid >= 0.12 and outer <= mid * 0.35:
                out.append((i, side))
                break
    return out


def _close_end(ink: np.ndarray, system: System, bars: list[int]) -> int | None:
    """줄 끝에 마디선이 없을 때, 오선이 끝나는 자리.

    마지막 마디를 세로줄로 닫지 않은 악보가 있다. 그러면 그 마디가
    통째로 빠져 화면에서 건너뛰어진다 — 오선 자체가 끝나는 자리를
    마지막 경계로 삼는다.
    """
    if len(bars) < 2:
        return None
    band = ink[system.top : system.bottom + 1, :]
    counts = band.sum(axis=0)
    inked = counts[counts > 0]
    if not inked.size:
        return None
    # 오선 줄만 있는 칸의 잉크 양. 그만큼이라도 있으면 오선이 이어진다.
    base = float(np.median(inked))
    on = np.nonzero(counts >= base * 0.6)[0]
    if not on.size:
        return None
    end = int(on[-1])
    gaps = [b - a for a, b in zip(bars, bars[1:])]
    med = float(np.median(gaps)) if gaps else 0.0
    # 한 마디의 반은 되어야 마디로 친다. 아니면 그저 오선의 꼬리다.
    if med <= 0 or end - bars[-1] < med * 0.5:
        return None
    return end


def _drop_slivers(bars: list[int]) -> list[int]:
    """마디 같지 않게 좁은 칸을 만든 세로줄을 뺀다.

    음표 기둥에 꼬리가 붙어 오선 위아래를 다 꿰면 마디선처럼 보인다.
    그렇게 생긴 가짜 선은 한 뼘도 안 되는 칸을 만든다 — 인쇄된 악보의
    마디는 한 줄 안에서 서로 엇비슷한 너비다. 가운데 너비의 3할도 안
    되는 칸은 마디가 아니라고 보고, 그 칸을 만든 선을 이웃에 붙인다.

    줄의 처음과 끝 선은 건드리지 않는다 — 그 둘은 줄의 경계다.
    """
    out = list(bars)
    for _ in range(len(bars)):
        if len(out) < 4:
            break
        gaps = [b - a for a, b in zip(out, out[1:])]
        med = float(np.median(gaps))
        i = int(np.argmin(gaps))
        if med <= 0 or gaps[i] >= med * 0.35:
            break
        # 좁은 칸을 어느 쪽 이웃에 붙일지 — 더 좁은 쪽에 붙여야
        # 남는 칸들이 고르다
        if i == 0:
            drop = 1
        elif i == len(gaps) - 1:
            drop = len(out) - 2
        elif gaps[i - 1] <= gaps[i + 1]:
            drop = i
        else:
            drop = i + 1
        out.pop(max(1, min(drop, len(out) - 2)))
    return out


def _open_start(ink: np.ndarray, system: System) -> int | None:
    """줄 첫머리에 마디선이 없을 때, 첫 마디가 시작하는 자리.

    악보는 줄이 바뀔 때마다 세로줄을 다시 긋지 않는다. 자리표와 조표만
    적고 곧바로 음표가 나온다. 그래서 그 사이의 **빈 칸**을 찾아 첫
    마디의 왼쪽 끝으로 삼는다.
    """
    band = ink[system.top : system.bottom + 1, :]
    # 오선 줄 자체는 왼쪽 끝부터 오른쪽 끝까지 이어져 있다. 그것만 있는
    # 칸을 「빈 칸」으로 봐야 한다 — 그러지 않으면 빈 칸이 하나도 없다.
    counts = band.sum(axis=0)
    inked = counts[counts > 0]
    base = float(np.median(inked)) if inked.size else 0.0
    used = counts > base + 3
    left = int(np.argmax(used)) if used.any() else 0
    # 자리표·조표를 지나 처음 나오는 빈 칸(3픽셀 이상)
    blank = 0
    for x in range(left + 6, band.shape[1]):
        if used[x]:
            blank = 0
            continue
        blank += 1
        if blank >= 3:
            return x - blank // 2
    return None


def _content_rows(ink: np.ndarray, system: System) -> np.ndarray:
    """오선 줄 자체를 뺀 잉크의 가로 분포. 가사·코드가 어디 있는지 보인다."""
    counts = ink.sum(axis=1)
    return counts


def _split(ink: np.ndarray, lo: int, hi: int) -> int:
    """두 줄 사이에서 **가장 넓게 빈 띠**의 한가운데.

    빈 자리를 비율로 나누면 곡마다 어긋난다 — 가사가 두 줄인 곳도
    있고 없는 곳도 있다. 실제로 비어 있는 자리를 찾아 거기서 자르면
    아래 줄의 가사도 안 잘리고 위 줄의 가사도 안 딸려 온다.
    """
    if hi <= lo + 2:
        return (lo + hi) // 2
    rows = ink[lo:hi].sum(axis=1)
    # 몇 픽셀 튀는 것은 잉크로 치지 않는다(글자 획의 끝, 점 따위)
    blank = rows <= max(int(ink.shape[1] * 0.004), 1)
    best, run, start = None, 0, 0
    for i, b in enumerate(list(blank) + [False]):
        if b:
            if run == 0:
                start = i
            run += 1
        else:
            if run and (best is None or run > best[1] - best[0]):
                best = (start, i)
            run = 0
    if best is None:
        return (lo + hi) // 2
    return lo + (best[0] + best[1]) // 2


def _view_bands(ink: np.ndarray, systems: list[System]) -> None:
    """줄마다 잘라 보일 띠를 정한다."""
    for i, s in enumerate(systems):
        staff = max(s.bottom - s.top, 1)
        if i == 0:
            # 첫 줄 위에도 코드가 적혀 있다. 오선 높이만큼만 띄우면 그
            # 글자를 반으로 자른다 — 오선 위 세 뼘 안에서 가장 넓게 빈
            # 자리를 찾아 거기서 끊는다. 제목까지 올라가지는 않는다.
            s.view_top = _split(ink, max(s.top - staff * 3, 0), s.top)
        else:
            s.view_top = _split(ink, systems[i - 1].bottom + 1, s.top)
        if s.pair_top is not None:
            # 2단 악보. 아래 단 바로 위까지 담는다.
            #
            # 가장 넓게 빈 자리에서 끊으면 오선과 가사 사이가 잘려 **2절
            # 가사가 통째로 날아간다**. 위 단에 딸린 것(1·2절 가사)은 모두
            # 아래 단 위에 있으니, 아래 단만 피하면 된다.
            # 가사 아래, 아래 단 위 — 그 사이에서 가장 넓게 빈 자리.
            # 오선 바로 밑까지 뒤지면 오선과 가사 사이가 이겨 버린다.
            mid = (s.bottom + s.pair_top) // 2
            s.view_bottom = min(
                _split(ink, mid, s.pair_top), s.pair_top - int(staff * 0.25)
            )
        elif i + 1 < len(systems):
            s.view_bottom = _split(ink, s.bottom + 1, systems[i + 1].top)
        else:
            s.view_bottom = min(s.bottom + staff * 2, ink.shape[0] - 1)
        # 오선에 너무 바싹 붙지 않게 최소 여유는 둔다
        s.view_top = min(s.view_top, s.top - int(staff * 0.35))
        s.view_bottom = max(s.view_bottom, s.bottom + int(staff * 0.35))


def _staff_left(ink: np.ndarray, system: System) -> int:
    """오선 줄이 시작하는 x. 이음표({)는 이보다 왼쪽에 있다."""
    band = ink[system.top : system.bottom + 1, :]
    counts = band.sum(axis=0)
    on = np.nonzero(counts >= max(system.lines - 1, 3))[0]
    return int(on[0]) if on.size else 0


def _braced(ink: np.ndarray, a: System, b: System) -> float:
    """두 오선이 이음표({)로 묶여 있나. 0~1.

    2단 악보(멜로디 + 반주)는 왼쪽에 큰 중괄호로 두 단을 묶는다. 그
    중괄호는 두 오선 **사이를 끝까지** 지난다 — 자리표 꼬리는 위쪽만
    조금 내려올 뿐이다. 그 차이로 가린다.
    """
    lo, hi = a.bottom + 3, b.top - 3
    if hi - lo < 6:
        return 0.0
    left = max(min(a.bars[0], b.bars[0]) - 4, 1)
    band = ink[lo:hi, 0:left]
    return float(band.any(axis=1).mean()) if band.size else 0.0


def _fold_pairs(ink: np.ndarray, systems: list[System]) -> list[System]:
    """2단 악보면 위 단만 남긴다.

    멜로디와 반주가 한 묶음으로 적힌 악보에서, 우리가 따라가야 하는
    것은 위 단(멜로디·코드·가사)이다. 아래 단까지 세면 마디 수가 곱절이
    되어 음원과 맞출 길이 없다.
    """
    if len(systems) < 4:
        return systems
    kept: list[System] = []
    i = 0
    pairs = 0
    while i < len(systems):
        if i + 1 < len(systems) and _braced(ink, systems[i], systems[i + 1]) >= 0.9:
            systems[i].pair_top = systems[i + 1].top
            kept.append(systems[i])
            pairs += 1
            i += 2
            continue
        kept.append(systems[i])
        i += 1
    # 두 묶음도 못 찾으면 2단 악보가 아니다. 괜히 줄을 버리지 않는다.
    return kept if pairs >= 2 else systems


def layout(image: Image.Image, index: int = 0) -> Page:
    ink = _ink(_gray(image))
    page = Page(index=index, width=image.width, height=image.height)
    for system in find_systems(ink):
        system.bars = find_bars(ink, system)
        if len(system.bars) < 2:
            # 마디선이 둘도 없으면 악보 줄이 아니라고 본다
            continue
        # 첫 마디선이 줄 첫머리에서 한참 떨어져 있으면, 그 줄은 세로줄
        # 없이 시작한 것이다. 자리표 뒤 빈 칸을 첫 경계로 넣어 준다.
        start = _open_start(ink, system)
        if start is not None and system.bars[0] - start > (system.bottom - system.top):
            system.bars.insert(0, start)
            system.made_start = True
        system.bars = _drop_slivers(system.bars)
        end = _close_end(ink, system, system.bars)
        if end is not None:
            system.bars.append(end)
            system.made_end = True
        if len(system.bars) < 2:
            continue
        system.repeats = find_repeats(ink, system)
        page.systems.append(system)
    page.systems = _fold_pairs(ink, page.systems)
    _view_bands(ink, page.systems)

    # 쪽 여백은 잘라 낸다. 화면이 좁은 폰에서는 이 여백이 곧 글씨 크기다.
    if page.systems:
        pad = max(image.width // 100, 4)
        left = min(s.bars[0] for s in page.systems)
        right = max(s.bars[-1] for s in page.systems)
        page.crop_left = max(left - pad * 3, 0)
        page.crop_right = min(right + pad, image.width - 1)
    else:
        page.crop_right = image.width - 1
    return page


def from_pdf(data: bytes, dpi: int = 200, max_pages: int = 20) -> tuple[list[Page], list[bytes]]:
    """PDF를 쪽마다 그림으로 펴고 배치를 잰다. (배치, PNG 바이트)"""
    import pymupdf

    doc = pymupdf.open(stream=data, filetype="pdf")
    pages: list[Page] = []
    images: list[bytes] = []
    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pix = page.get_pixmap(dpi=dpi)
        png = pix.tobytes("png")
        images.append(png)
        pages.append(layout(Image.open(io.BytesIO(png)), i))
    return pages, images


def from_image(data: bytes) -> tuple[list[Page], list[bytes]]:
    img = Image.open(io.BytesIO(data))
    return [layout(img, 0)], [data]


def to_dict(pages: list[Page]) -> dict:
    """앱으로 넘길 모양. 자리는 0~1 비율로 — 화면 크기와 무관하게 쓴다."""
    out = []
    for p in pages:
        out.append({
            "index": p.index,
            "width": p.width,
            "height": p.height,
            "systems": [
                {
                    "top": round(s.top / p.height, 5),
                    "bottom": round(s.bottom / p.height, 5),
                    "lines": s.lines,
                    "bars": [round(x / p.width, 5) for x in s.bars],
                }
                for s in p.systems
            ],
        })
    return {"pages": out}
