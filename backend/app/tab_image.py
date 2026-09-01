"""
그림 타브 악보(PDF)를 읽어 마디별 프렛 숫자로 옮긴다.

AI에게 그림을 읽히지 않는다. 인쇄된 악보는 자로 잴 수 있다 —
여섯 줄은 가로로 긴 줄이고, 마디선은 그 여섯 줄을 관통하다 맨 아랫줄에서
멈추며(음표 기둥은 빔까지 더 내려간다), 숫자는 같은 판에서 찍혀 나와
모양이 픽셀까지 같다. 그래서 모양 몇 가지에 이름을 한 번 붙여 두면
나머지 수백 개가 저절로 읽힌다.

  learn : 한 악보에서 모양을 뽑아 이름을 붙여 templates.json 에 쌓는다
  read  : 쌓아 둔 모양으로 아무 악보나 읽는다

같은 곳에서 만든 악보라면 한 번 배운 것으로 계속 읽는다.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

TEMPLATES = Path(__file__).with_name("tab_templates.json")
DIGIT_BOX = (16, 20)   # 숫자 견본 크기
MARK_BOX = (16, 16)    # 스트로크 표 견본 크기


# ── 그림에서 뼈대 찾기 ────────────────────────────────────────────

def pages(pdf: str | Path, dpi: int = 300) -> list[np.ndarray]:
    """PDF를 흑백 판(먹=True)으로 편다"""
    import pymupdf

    doc = pymupdf.open(str(pdf))
    out = []
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("L")
        out.append(np.array(img) < 128)
    return out


def staff_lines(ink: np.ndarray) -> list[int]:
    """가로로 긴 줄 = 타브 여섯 줄"""
    w = ink.shape[1]
    idx = np.where(ink.sum(1) > w * 0.55)[0]
    if not len(idx):
        return []
    lines, start, prev = [], idx[0], idx[0]
    for y in idx[1:]:
        if y - prev > 3:
            lines.append((start + prev) // 2)
            start = y
        prev = y
    lines.append((start + prev) // 2)
    return lines


def systems(ink: np.ndarray) -> list[list[int]]:
    ls = staff_lines(ink)
    return [ls[i:i + 6] for i in range(0, len(ls) - 5, 6)]


def barlines(ink: np.ndarray, st: list[int]) -> list[int]:
    """
    마디선만 고른다.
    음표 기둥도 여섯 줄을 관통하지만 아래 빔까지 더 내려간다 — 그 차이로 가른다.
    """
    sp = (st[-1] - st[0]) / 5.0
    inside = ink[st[0]:st[-1] + 1]
    below = ink[int(st[-1] + sp * 0.45):int(st[-1] + sp * 1.1)]
    above = ink[int(st[0] - sp * 0.9):int(st[0] - sp * 0.25)]
    xs = [
        x for x in range(inside.shape[1])
        if inside[:, x].mean() >= 0.92
        and below[:, x].mean() <= 0.5
        and above[:, x].mean() <= 0.5
    ]
    out: list[int] = []
    cur: list[int] = []
    for x in xs:
        if cur and x - cur[-1] > sp * 0.5:
            out.append(sum(cur) // len(cur))
            cur = []
        cur.append(x)
    if cur:
        out.append(sum(cur) // len(cur))
    return _drop_slivers(out)


def _drop_slivers(xs: list[int]) -> list[int]:
    """
    도돌이표(𝄆)의 굵은 줄도 여섯 줄을 관통해 마디선처럼 보인다.
    그대로 두면 그 앞에 폭이 손가락만 한 유령 마디가 하나 생기고,
    뒤의 마디 번호가 통째로 한 칸씩 밀린다.

    한 단 안의 마디는 폭이 고른 편이다 — 가운데값의 절반도 안 되는
    토막은 마디가 아니라 표시라고 보고 경계 하나를 걷는다.
    """
    if len(xs) < 3:
        return xs
    while len(xs) > 2:
        gaps = [b - a for a, b in zip(xs, xs[1:])]
        mid = sorted(gaps)[len(gaps) // 2]
        i = min(range(len(gaps)), key=lambda k: gaps[k])
        if gaps[i] >= mid * 0.45:
            break
        # 맨 앞 토막이면 왼쪽 경계를, 아니면 오른쪽 경계를 걷는다.
        # 도돌이표는 마디 첫머리에 서므로 그 자리를 마디 시작으로 남긴다.
        xs.pop(i if i == 0 else i + 1)
    return xs


def _strip_lines(band: np.ndarray, ys: list[int], sp: float) -> np.ndarray:
    """오선을 지우되 '긴 가로 이음'만 지운다 — 줄에 닿은 숫자가 잘리지 않게"""
    out = band.copy()
    lim = int(sp * 2.5)
    for y in ys:
        for d in range(-2, 3):
            r = y + d
            if not (0 <= r < out.shape[0]):
                continue
            row = out[r]
            x = 0
            while x < len(row):
                if row[x]:
                    x2 = x
                    while x2 < len(row) and row[x2]:
                        x2 += 1
                    if x2 - x >= lim:
                        out[r, x:x2] = False
                    x = x2
                else:
                    x += 1
    return out


def _boxes(band: np.ndarray, keep) -> list[tuple[slice, slice]]:
    lab, _ = ndimage.label(band, structure=np.ones((3, 3)))
    return [sl for sl in ndimage.find_objects(lab) if keep(sl)]


def _norm(band: np.ndarray, sl, box) -> np.ndarray:
    img = Image.fromarray((band[sl] * 255).astype(np.uint8)).resize(box)
    return np.array(img) > 127


def digit_glyphs(ink: np.ndarray, st: list[int]) -> list[tuple[int, int, np.ndarray]]:
    """(x, 몇 번 줄, 모양) 목록. 맨 위가 1번 줄"""
    sp = (st[-1] - st[0]) / 5.0
    top, bot = int(st[0] - sp * 0.8), int(st[-1] + sp * 0.8)
    band = _strip_lines(ink[top:bot], [y - top for y in st], sp)
    out = []
    for sl in _boxes(band, lambda sl: (
        sp * 0.5 < sl[0].stop - sl[0].start < sp * 1.3
        and sp * 0.25 < sl[1].stop - sl[1].start < sp * 1.4
    )):
        cy = (sl[0].start + sl[0].stop) / 2 + top
        k = int(np.argmin([abs(cy - y) for y in st]))
        if abs(cy - st[k]) > sp * 0.4:
            continue
        out.append(((sl[1].start + sl[1].stop) // 2, k + 1, _norm(band, sl, DIGIT_BOX)))
    out.sort(key=lambda g: g[0])
    return out


def mark_glyphs(
    ink: np.ndarray, st: list[int], book: list[tuple[str, np.ndarray]] | None = None
) -> list[tuple[int, np.ndarray, bool]]:
    """
    오선 아래 스트로크 표(∏·∨) 후보.

    두 가지를 조심한다.
      · 가사도 함께 걸린다 → 견본에 맞는 것만 남긴다(부르는 쪽에서 거른다)
      · **이웃한 표끼리 붙어** 한 덩어리로 잡힌다 → 폭이 여러 곱이면 그만큼
        고르게 갈라 읽는다. 이걸 안 하면 훑는 마디의 손 방향이 절반만 나온다.
    """
    sp = (st[-1] - st[0]) / 5.0
    top = int(st[-1] + sp * 1.2)
    bot = min(ink.shape[0], int(st[-1] + sp * 6.0))
    band = ink[top:bot]
    raw = _boxes(band, lambda sl: (
        sp * 0.55 < sl[0].stop - sl[0].start < sp * 1.1
        and sp * 0.4 < sl[1].stop - sl[1].start < sp * 6.0
    ))
    if not raw:
        return []

    # 표 한 개의 폭과 표가 놓인 높이. 둘 다 **견본에 그대로 맞는 것**에서만
    # 얻는다. 아무 덩어리나 세면 가사가 그 자리를 차지해 버린다.
    solo = [
        sl for sl in raw
        if sl[1].stop - sl[1].start <= sp * 1.4
        and (book is None or _match(_norm(band, sl, MARK_BOX), book, 26))
    ]
    if not solo:
        return []
    unit = sorted(sl[1].stop - sl[1].start for sl in solo)[len(solo) // 2]
    ys = sorted((sl[0].start + sl[0].stop) / 2 for sl in solo)
    row = ys[len(ys) // 2]

    out = []
    for sl in raw:
        cy = (sl[0].start + sl[0].stop) / 2
        if abs(cy - row) > sp * 0.4:
            continue
        w = sl[1].stop - sl[1].start
        n = max(1, round(w / unit))
        if n == 1:
            out.append(
                (int((sl[1].start + sl[1].stop) // 2), _norm(band, sl, MARK_BOX), False)
            )
            continue
        # 붙어 버린 덩어리는 **똑같이 잘라서는** 안 된다. 표끼리 살짝
        # 겹쳐 있어 반씩 자르면 둘 다 반쪽이 되어 아무것도 알아보지
        # 못한다. 표 한 개 폭짜리 창을 겹쳐 가며 옮겨 훑는다.
        step = (w - unit) / (n - 1)
        for k in range(n):
            x0 = sl[1].start + round(step * k)
            part = (sl[0], slice(x0, x1 := x0 + unit))
            out.append(((x0 + x1) // 2, _norm(band, part, MARK_BOX), True))
    out.sort(key=lambda g: g[0])
    # 겹쳐 잡힌 같은 표는 하나로. 덩어리 나누기가 이웃과 겹칠 수 있다.
    kept: list[tuple[int, np.ndarray, bool]] = []
    for g in out:
        if kept and g[0] - kept[-1][0] < unit * 0.55:
            continue
        kept.append(g)
    return kept


# ── 모양 익히기 · 알아보기 ────────────────────────────────────────

def _cluster(pats: list[np.ndarray], tol: int) -> list[list[np.ndarray]]:
    groups: list[list[np.ndarray]] = []
    for p in pats:
        for g in groups:
            if int((g[0] ^ p).sum()) <= tol:
                g.append(p)
                break
        else:
            groups.append([p])
    groups.sort(key=len, reverse=True)
    return groups


def mark_kind(pat: np.ndarray) -> str:
    """
    스트로크 표가 ∏인지 ∨인지, 견본 없이 모양만 보고 가른다.

    ∏은 윗줄이 가로로 꽉 찼고 ∨은 위가 뚫려 있다 — 이 하나로 갈린다.
    붙어 있던 표를 갈라 낸 조각은 견본과 딱 맞지 않는데, 그런 조각도
    이 잣대로는 읽힌다.
    """
    return "D" if pat[: max(1, len(pat) // 5)].mean() > 0.55 else "U"


def _match(pat: np.ndarray, book: list[tuple[str, np.ndarray]], tol: int) -> str | None:
    best, score = None, tol + 1
    for name, tpl in book:
        d = int((tpl ^ pat).sum())
        if d < score:
            best, score = name, d
    return best if score <= tol else None


def load_book() -> dict:
    if not TEMPLATES.exists():
        return {"digits": [], "marks": []}
    raw = json.loads(TEMPLATES.read_text(encoding="utf-8"))
    for kind, box in (("digits", DIGIT_BOX), ("marks", MARK_BOX)):
        raw[kind] = [
            (t["name"], np.array(t["bits"], dtype=bool).reshape(box[1], box[0]))
            for t in raw.get(kind, [])
        ]
    return raw


def save_book(book: dict) -> None:
    out = {
        kind: [{"name": n, "bits": p.astype(int).ravel().tolist()} for n, p in book.get(kind, [])]
        for kind in ("digits", "marks")
    }
    TEMPLATES.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")


# ── 악보 한 벌 읽기 ──────────────────────────────────────────────

def read_tab(pdf: str | Path, dpi: int = 300) -> dict:
    """
    마디 목록을 낸다.

      {"measures": [
         {"no": 1, "kind": "pick",  "cols": [{"1": 3, "6": 3}, {"4": 0}, …]},
         {"no": 26, "kind": "strum", "chord": {"1":3,…}, "strokes": "DDDDUDDDDU"},
       ]}

    kind 는 그 마디를 어떻게 치는가다. 빗금(∕)이 있으면 훑는 마디,
    아니면 뜯는 마디. 훑는 마디는 숫자 대신 코드 한 벌과 손 방향을 담는다.
    """
    book = load_book()
    digits, marks = book["digits"], book["marks"]
    out: list[dict] = []

    for page_no, ink in enumerate(pages(pdf, dpi), 1):
        for sys_no, st in enumerate(systems(ink), 1):
            sp = (st[-1] - st[0]) / 5.0
            bl = barlines(ink, st)
            if len(bl) < 2:
                continue
            gs = digit_glyphs(ink, st)
            # 견본에 맞으면 그대로 쓴다. 붙어 있다 갈라진 조각만은 견본과
            # 딱 맞지 않으므로 모양으로 가른다 — 성한 덩어리에까지 이 길을
            # 열어 주면 가사 글자가 모두 스트로크로 읽힌다.
            ms = [
                (x, _match(p, marks, 26) or (mark_kind(p) if cut else None))
                for x, p, cut in mark_glyphs(ink, st, marks)
            ]
            ms = [(x, n) for x, n in ms if n]

            for i in range(len(bl) - 1):
                lo, hi = bl[i], bl[i + 1]
                inb = [g for g in gs if lo + sp * 0.15 < g[0] < hi - sp * 0.1]
                cols: list[list] = []
                cur: list = []
                for g in inb:
                    if cur and g[0] - cur[-1][0] > sp * 0.6:
                        cols.append(cur)
                        cur = []
                    cur.append(g)
                if cur:
                    cols.append(cur)

                read = [
                    {str(k): _match(p, digits, 14) for _, k, p in col}
                    for col in cols
                ]
                strokes = "".join(n for x, n in ms if lo < x < hi)
                bar: dict = {"no": len(out) + 1, "page": page_no, "system": sys_no}

                # 훑는 마디인지는 손 방향 표가 말해 준다. 빗금(∕)은 위아래로
                # 길어 숫자 크기 재기에 걸리지 않으므로 기준으로 쓰지 않는다.
                if strokes:
                    # 첫머리에 통째로 잡는 코드 한 벌이 온다
                    shape = next((c for c in read if len(c) >= 3), read[0] if read else {})
                    bar |= {"kind": "strum",
                            "chord": {k: int(v) for k, v in shape.items() if v and v.isdigit()},
                            "strokes": strokes}
                else:
                    bar |= {"kind": "pick",
                            "cols": [{k: int(v) for k, v in c.items() if v and v.isdigit()}
                                     for c in read if c and not all(v == "/" for v in c.values())]}
                out.append(bar)
    return {"measures": out}


def learn(pdf: str | Path, digit_names: str, mark_names: str, dpi: int = 300) -> dict:
    """
    악보에서 모양을 뽑아 이름을 붙인다.
    이름을 주지 않으면 모양만 그려 낸다 — 그림을 보고 이름을 정해 다시 부른다.
    """
    dpats, mpats = [], []
    for ink in pages(pdf, dpi):
        for st in systems(ink):
            dpats += [p for _, _, p in digit_glyphs(ink, st)]
            mpats += [p for _, p, _ in mark_glyphs(ink, st)]  # 익힐 때는 견본이 없다
    dg = _cluster(dpats, 14)
    # 스트로크 표는 오선 아래 것을 다 주웠으므로, 여러 번 나온 모양만 남긴다
    mg = [g for g in _cluster(mpats, 10) if len(g) >= 4]
    return {"digits": dg, "marks": mg, "dnames": digit_names, "mnames": mark_names}


def montage(groups: list[list[np.ndarray]], path: str, cell=(70, 90)) -> None:
    tiles = [Image.fromarray((~g[0] * 255).astype(np.uint8)).resize(cell, Image.NEAREST)
             for g in groups]
    sheet = Image.new("L", (len(tiles) * (cell[0] + 10) + 10, cell[1] + 20), 255)
    for i, t in enumerate(tiles):
        sheet.paste(t, (10 + i * (cell[0] + 10), 10))
    sheet.save(path)
