"""종이 악보(PDF·그림) → MusicXML — Audiveris로 음표·마디를 읽는다.

음원 채보는 오류가 많고 디지털 악보(.mscz)는 구하기 어렵다(강사님). 인쇄 악보를
Audiveris(OMR)로 읽으면 마디 수·음높이는 거의 정확하다 — 「잊혀지는 것」 PDF에서
68/68마디, 음높이 99%. 다만 들보(8분음표 묶음)를 통째로 놓쳐 8분음표가 4분음표로
나왔다(해상도·들보 두께 지정으로도 안 됨). 인쇄 악보는 음 길이에 비례해 음표
간격을 두므로, 마디 안 **가로 간격 비율**로 길이를 다시 매기고 합을 박자표에
맞추면 95%가 돌아온다(마디 57/68 완전 일치).

곡에 붙여 둔 그림 악보의 마디 자리(sheet.bars)가 있으면 두 가지를 더 한다.

- **마디를 그림 마디 자리로 다시 나눈다.** OMR은 마디선을 놓쳐 두세 마디를 한
  마디로 붙이거나 한 마디를 통째로 놓친다 — 「동해의꿈」은 117마디가 113마디로
  읽혀, 그 뒤 코드·가사가 한두 마디씩 밀렸다. 그림 마디 자리(117)는 정확하다.
- **글자가 든 PDF면 코드·가사·빠르기를 글자 그대로 넣는다.** 악보 프로그램이
  만든 PDF는 코드 이름·가사가 그림이 아닌 글자다 — OCR·AI보다 정확하다. 스캔
  PDF·사진은 글자가 없어 건너뛴다(코드는 앱의 AI 그림 읽기가 맡는다).
"""

from __future__ import annotations

import asyncio
import copy
import re
import shutil
import statistics
import tempfile
import zipfile
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
from xml.etree import ElementTree as ET

from .config import settings

# 인식에 쓸 길이 눈금(4분음표 수) — 반 박 단위. 16분·점8분음표까지 눈금에 넣으면
# 간격의 작은 흔들림이 그쪽으로 붙어 오답이 늘었다(7개). 셋잇단도 8분음표로 본다
GRID = [Fraction(1, 2), Fraction(1), Fraction(3, 2), Fraction(2), Fraction(5, 2),
        Fraction(3), Fraction(7, 2), Fraction(4)]
STEP = Fraction(1, 2)
# MusicXML type 이름 — 길이(4분음표 수)에서
TYPE_OF = {
    Fraction(4): ("whole", 0), Fraction(3): ("half", 1), Fraction(2): ("half", 0),
    Fraction(3, 2): ("quarter", 1), Fraction(1): ("quarter", 0), Fraction(3, 4): ("eighth", 1),
    Fraction(1, 2): ("eighth", 0), Fraction(3, 8): ("16th", 1), Fraction(1, 4): ("16th", 0),
    Fraction(7, 2): ("half", 2), Fraction(5, 2): ("half", 0),  # 5/2는 2분음표 + 붙임줄 대신 근사
}
DIVISIONS = 8  # 새로 적는 duration의 4분음표당 눈금

HANGUL = re.compile(r"[가-힣]")
CHORD = re.compile(
    r"^([A-G])([#b]?)((?:m|maj|min|dim|aug|sus|add|M)?\d*(?:\(?[#b]?\d+\)?)*)(?:/([A-G])([#b]?))?$"
)


def audiveris_exe() -> Path | None:
    for p in (settings.audiveris_exe, r"C:\Program Files\Audiveris\Audiveris.exe"):
        if p and Path(p).exists():
            return Path(p)
    return None


def available() -> bool:
    return audiveris_exe() is not None


async def recognize(source: Path, sheet: dict | None = None) -> dict:
    """PDF·그림 → {"xml": MusicXML 글, "parts": [...], "measures": n, ...}. 실패하면 던진다.

    sheet는 곡에 붙여 둔 그림 악보(같은 파일에서 찾은 마디 자리). 있으면 마디를 그
    자리로 다시 나누고, 글자가 든 PDF면 코드·가사·빠르기를 넣는다.
    """
    exe = audiveris_exe()
    if exe is None:
        raise RuntimeError("Audiveris가 설치되어 있지 않습니다")
    work = Path(tempfile.mkdtemp(prefix="omr-"))
    try:
        # 이름에 한글·공백이 있으면 Audiveris가 책 이름을 못 만든다 — 단순한 이름으로 복사
        src = work / f"score{source.suffix.lower()}"
        shutil.copy(source, src)
        out = work / "out"
        out.mkdir()
        cmd = [str(exe), "-batch", "-transcribe", "-export", "-output", str(out), str(src)]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=600)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError("악보 인식이 10분을 넘겨 멈췄습니다")
        mxls = sorted(out.rglob("*.mxl"))
        if not mxls:
            raise RuntimeError("악보에서 오선을 찾지 못했습니다")
        root = _read_mxl(mxls[0])
        extra: dict = {"aligned": False, "text": None}
        bars = (sheet or {}).get("bars") or []
        if bars:
            extra["aligned"] = align_to_sheet(root, bars)
            if src.suffix == ".pdf":
                try:
                    text = pdf_bar_text(src, bars)
                    if extra["aligned"]:
                        extra["text"] = embed_text(root, bars, text)
                except Exception as exc:  # 글자 꺼내기는 덤이다 — 실패해도 음표는 준다
                    extra["text"] = {"error": str(exc)}
        drop_orphan_endings(root)
        stats = repair_durations(root)
        xml = ET.tostring(root, encoding="unicode")
        return {"xml": xml, **stats, **extra}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def drop_orphan_endings(root: ET.Element) -> int:
    """도돌이표가 하나도 없는데 1·2번 괄호가 있으면 OMR이 지어낸 것이다 — 지운다.

    되돌아갈 곳이 없는 괄호는 뜻이 없다. 「동해의꿈」(도돌이 없이 117마디)을 OMR이
    읽자 괄호가 13곳 생겨, 서버가 「2번 괄호」 마디를 건너뛰어 108마디로 폈다
    (앱의 musicxmlToAbc도 같은 규칙으로 무시한다). 지운 수를 돌려준다.
    """
    if root.find(".//repeat") is not None:
        return 0
    n = 0
    for bl in root.iter("barline"):
        for e in bl.findall("ending"):
            bl.remove(e)
            n += 1
    return n


def _read_mxl(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and not n.startswith("META-INF"))
        return ET.fromstring(z.read(name))


# ---------------------------------------------------------------- 마디 다시 나누기


def _systems(part: ET.Element) -> list[list[ET.Element]]:
    """파트의 마디를 줄(시스템)마다 묶는다 — <print new-system/new-page>가 줄 머리다."""
    systems: list[list[ET.Element]] = []
    cur: list[ET.Element] = []
    for m in part.findall("measure"):
        pr = m.find("print")
        if cur and pr is not None and (pr.get("new-system") == "yes" or pr.get("new-page") == "yes"):
            systems.append(cur)
            cur = []
        cur.append(m)
    if cur:
        systems.append(cur)
    return systems


def _sheet_systems(bars: list[dict]) -> list[list[int]]:
    """그림 마디 자리를 줄마다 묶는다(쪽·줄 차례대로). 값은 bars의 차례 번호."""
    out: list[list[int]] = []
    key = None
    for i, b in enumerate(bars):
        k = (b.get("page"), b.get("system"))
        if k != key:
            out.append([])
            key = k
        out[-1].append(i)
    return out


def _first_voice(m: ET.Element) -> list[ET.Element]:
    """첫 성부의 음표(화음의 둘째 음 포함) — 뒤 성부는 OMR이 지어낸 쉼표가 많다."""
    notes = []
    for el in m:
        if el.tag == "backup":
            break
        if el.tag == "note":
            notes.append(el)
    return notes


def _rest_measure(width: float) -> ET.Element:
    """온쉼표 한 마디(놓친 마디를 채운다). 길이는 뒤의 repair_durations가 박자표에 맞춘다."""
    m = ET.Element("measure", {"width": str(round(width))})
    n = ET.SubElement(m, "note", {"default-x": "10"})
    ET.SubElement(n, "rest", {"measure": "yes"})
    ET.SubElement(n, "duration").text = "4"
    ET.SubElement(n, "voice").text = "1"
    ET.SubElement(n, "type").text = "whole"
    return m


def _split(m: ET.Element, widths: list[float]) -> list[ET.Element]:
    """붙은 마디를 폭 비율대로 가른다. 음표는 가로 자리(default-x)로 나눈다."""
    W = float(m.get("width") or 0) or sum(widths)
    total = sum(widths) or 1.0
    bounds = [0.0]
    for w in widths:
        bounds.append(bounds[-1] + w / total * W)
    voice = _first_voice(m)
    out = []
    for k in range(len(widths)):
        nm = ET.Element("measure", {"width": str(round(bounds[k + 1] - bounds[k]))})
        if k == 0:
            for el in m:
                if el.tag in ("print", "attributes"):
                    nm.append(copy.deepcopy(el))
        lo, hi = bounds[k], bounds[k + 1]
        last = k == len(widths) - 1
        for n in voice:
            x = float(n.get("default-x") or 0)
            if lo <= x < hi or (last and x >= hi):
                n2 = copy.deepcopy(n)
                n2.set("default-x", str(round(x - lo, 1)))
                nm.append(n2)
        if not nm.findall("note"):
            rest = _rest_measure(hi - lo).find("note")
            nm.append(rest)
        if last:
            for el in m.findall("barline"):
                nm.append(copy.deepcopy(el))
        out.append(nm)
    return out


def align_to_sheet(root: ET.Element, bars: list[dict]) -> bool:
    """첫 파트(멜로디)의 마디를 그림 마디 자리 수에 맞춘다. 맞췄으면 True.

    줄마다 본다 — OMR의 줄과 그림의 줄은 같은 차례다. 마디 수가 같은 줄은 그대로,
    적은 줄은 넓은 마디를 그림 마디 폭 비율로 가르고, 그래도 모자라면 줄 끝에 빈
    마디를 채운다(어느 마디를 놓쳤는지는 알 수 없어 줄 끝에 둔다 — 틀려도 그 줄
    안에서 그친다). 줄 수부터 다르면 손대지 않는다.
    """
    parts = root.findall("part")
    if not parts:
        return False
    part = parts[0]
    oms = _systems(part)
    sbs = _sheet_systems(bars)
    if len(oms) != len(sbs):
        return False
    # 그림 폭 → OMR 폭 배율. 마디 수가 맞는 줄들에서 잰다
    ratios = []
    for om, sb in zip(oms, sbs):
        if len(om) == len(sb):
            sw = sum(bars[j]["x1"] - bars[j]["x0"] for j in sb)
            ow = sum(float(m.get("width") or 0) for m in om)
            if sw > 0 and ow > 0:
                ratios.append(ow / sw)
    if not ratios:
        return False
    k = statistics.median(ratios)

    new_measures: list[ET.Element] = []
    changed = False
    for om, sb in zip(oms, sbs):
        if len(om) == len(sb):
            new_measures.extend(om)
            continue
        changed = True
        exp = [k * (bars[j]["x1"] - bars[j]["x0"]) for j in sb]
        j = 0
        groups: list[tuple[ET.Element, list[float]]] = []
        for i, m in enumerate(om):
            w = float(m.get("width") or 0)
            left = len(om) - i - 1  # 뒤에 남은 OMR 마디 — 그림 마디를 하나씩은 남겨 둔다
            take: list[float] = []
            acc = 0.0
            while j < len(sb) - left:
                e = exp[j]
                if take and acc + e > w + 0.4 * e:
                    break
                take.append(e)
                acc += e
                j += 1
            if not take:  # 그림 마디가 모자라면(OMR이 한 마디를 둘로 갈랐다) 앞 마디에 붙인다
                if groups:
                    prev, pw = groups[-1]
                    for n in _first_voice(m):
                        n.set("default-x", str(float(n.get("default-x") or 0) + float(prev.get("width") or 0)))
                        prev.append(n)
                    prev.set("width", str(round(float(prev.get("width") or 0) + w)))
                continue
            groups.append((m, take))
        for m, take in groups:
            new_measures.extend([m] if len(take) == 1 else _split(m, take))
        for jj in range(j, len(sb)):
            new_measures.append(_rest_measure(exp[jj]))
    # 파트를 새 마디로 갈아 끼우고 번호를 새로 매긴다
    for m in list(part):
        if m.tag == "measure":
            part.remove(m)
    for i, m in enumerate(new_measures):
        m.set("number", str(i + 1))
        part.append(m)
    # 다른 파트(타브 등)는 마디 수가 달라져 짝이 안 맞는다 — 멜로디만 남긴다
    for p in parts[1:]:
        root.remove(p)
    pl = root.find("part-list")
    if pl is not None:
        keep = part.get("id")
        for sp in list(pl):
            if sp.tag == "score-part" and sp.get("id") != keep:
                pl.remove(sp)
    return True if changed or len(new_measures) == len(bars) else False


# ---------------------------------------------------------------- PDF 글자


def pdf_bar_text(pdf: Path, bars: list[dict]) -> dict:
    """글자가 든 PDF에서 마디마다 코드·가사를 꺼낸다(자리째).

    돌려주는 것: {"bars": [{"chords": [(자리, 이름)], "verses": [[(자리, 음절)]…]}…],
    "tempo": ♩값|None, "title": 제목|None}. 자리는 마디 폭 안의 0~1.
    """
    import fitz  # PyMuPDF

    doc = fitz.open(str(pdf))
    out = [{"chords": [], "lyr": []} for _ in bars]
    by_page: dict[int, list[int]] = defaultdict(list)
    for i, b in enumerate(bars):
        by_page[int(b.get("page") or 0)].append(i)
    tempo = None
    title = None
    for pno, idx in by_page.items():
        if pno >= len(doc):
            continue
        page = doc[pno]
        W, H = page.rect.width, page.rect.height
        words = page.get_text("words")
        lines: dict[tuple, list[str]] = defaultdict(list)
        for w in words:
            lines[(w[5], w[6])].append(w[4])
        for x0, y0, x1, y1, t, blk, ln, _ in words:
            cx, cy = (x0 + x1) / 2 / W, (y0 + y1) / 2 / H
            hit = None
            for i in idx:
                b = bars[i]
                if b["x0"] <= cx < b["x1"] and b.get("viewTop", b["top"]) <= cy < b.get("viewBottom", b["bottom"]):
                    hit = i
                    break
            if pno == min(by_page) and tempo is None and t.isdigit() and 40 <= int(t) <= 300:
                first = bars[idx[0]]
                if cy < first["top"] and any("=" in s for s in lines[(blk, ln)]):
                    tempo = int(t)
                    continue
            if hit is None:
                continue
            b = bars[hit]
            bw = (b["x1"] - b["x0"]) or 1.0
            if HANGUL.search(t):
                syls = [c for c in t if HANGUL.match(c)]
                for k, c in enumerate(syls):
                    sx = (x0 + (x1 - x0) * (k + 0.5) / len(syls)) / W
                    out[hit]["lyr"].append((cy, (sx - b["x0"]) / bw, c))
            else:
                name = t.replace("♭", "b").replace("♯", "#")
                if CHORD.match(name):
                    out[hit]["chords"].append(((cx - b["x0"]) / bw, name))
        if pno == min(by_page):
            # 제목 — 첫 쪽에서 가장 큰 한글 글자
            best = 0.0
            for blk in page.get_text("dict")["blocks"]:
                for line in blk.get("lines", []):
                    for sp in line.get("spans", []):
                        s = sp.get("text", "").strip()
                        if HANGUL.search(s) and sp.get("size", 0) > best:
                            best = sp["size"]
                            title = s
    # 가사 줄(절) — 줄(시스템)마다 가사의 높이를 묶어 위에서부터 1절·2절
    res = []
    sys_of = {}
    for s, ids in enumerate(_sheet_systems(bars)):
        for i in ids:
            sys_of[i] = s
    heights: dict[int, list[float]] = defaultdict(list)
    for i, o in enumerate(out):
        heights[sys_of[i]].extend(cy for cy, _, _ in o["lyr"])
    rows: dict[int, list[float]] = {}
    for s, hs in heights.items():
        hs = sorted(hs)
        centers: list[float] = []
        for h in hs:
            if not centers or h - centers[-1] > 0.008:
                centers.append(h)
        rows[s] = centers
    for i, o in enumerate(out):
        centers = rows.get(sys_of[i], [])
        verses: list[list[tuple[float, str]]] = [[] for _ in centers]
        for cy, f, c in o["lyr"]:
            v = min(range(len(centers)), key=lambda k: abs(centers[k] - cy)) if centers else 0
            verses[v].append((f, c))
        res.append({
            "chords": sorted(o["chords"]),
            "verses": [sorted(v) for v in verses],
        })
    return {"bars": res, "tempo": tempo, "title": title}


def _harmony(name: str) -> ET.Element | None:
    m = CHORD.match(name)
    if not m:
        return None
    step, acc, suffix, bstep, bacc = m.groups()
    h = ET.Element("harmony")
    r = ET.SubElement(h, "root")
    ET.SubElement(r, "root-step").text = step
    if acc:
        ET.SubElement(r, "root-alter").text = "1" if acc == "#" else "-1"
    kind = ET.SubElement(h, "kind", {"text": suffix or ""})
    kind.text = "major" if not suffix else "other"
    if bstep:
        bs = ET.SubElement(h, "bass")
        ET.SubElement(bs, "bass-step").text = bstep
        if bacc:
            ET.SubElement(bs, "bass-alter").text = "1" if bacc == "#" else "-1"
    return h


def embed_text(root: ET.Element, bars: list[dict], text: dict) -> dict:
    """PDF 글자의 코드·가사·빠르기·제목을 멜로디 파트에 넣는다. 통계를 돌려준다."""
    part = root.findall("part")[0]
    measures = part.findall("measure")
    tb = text.get("bars") or []
    chord_bars = sum(1 for b in tb if b["chords"])
    lyric_bars = sum(1 for b in tb if any(b["verses"]))
    if chord_bars:
        # OMR이 OCR로 지어낸 코드는 버린다 — 글자 코드가 정답이다
        for m in measures:
            for h in m.findall("harmony"):
                m.remove(h)
    placed = 0
    lost = 0
    for m, info in zip(measures, tb):
        voice = [n for n in _first_voice(m) if n.find("chord") is None]
        if not voice:
            continue
        W = float(m.get("width") or 0) or 1.0
        frac = [float(n.get("default-x") or 0) / W for n in voice]
        # 가사 — 쉼표·붙임줄로 이어진 음은 음절을 받지 않는다
        cand = [
            k for k, n in enumerate(voice)
            if n.find("rest") is None and not any(t.get("type") == "stop" for t in n.findall("tie"))
        ]
        for v, syls in enumerate(info["verses"]):
            if not syls:
                continue
            if not cand:
                lost += len(syls)  # 음표가 없는 마디(OMR이 통째로 놓친 마디)
                continue
            # 음표마다 붙일 음절들. 음표가 넉넉하면 하나씩 가까운 음표에(차례 유지),
            # 모자라면(OMR이 들보 음을 놓쳐 「마른그대여」 다섯 음절에 음표 둘) 가까운
            # 음표에 묶어 붙인다 — 음표는 틀려도 가사 글자는 잃지 않는다
            groups: dict[int, list[str]] = defaultdict(list)
            if len(syls) <= len(cand):
                p = 0
                for s, (f, c) in enumerate(syls):
                    hi = len(cand) - (len(syls) - s)
                    q = min(range(p, hi + 1), key=lambda q: abs(frac[cand[q]] - f))
                    groups[q].append(c)
                    p = q + 1
            else:
                prev = 0
                for f, c in syls:
                    q = min(range(len(cand)), key=lambda q: abs(frac[cand[q]] - f))
                    q = max(q, prev)
                    groups[q].append(c)
                    prev = q
            for q, cs in groups.items():
                ly = ET.SubElement(voice[cand[q]], "lyric", {"number": str(v + 1)})
                ET.SubElement(ly, "syllabic").text = "single"
                ET.SubElement(ly, "text").text = "".join(cs)
                placed += len(cs)
        # 코드 — 그 자리에 가장 가까운 음 앞에
        kids = list(m)
        for f, name in info["chords"]:
            h = _harmony(name)
            if h is None:
                continue
            k = min(range(len(voice)), key=lambda q: abs(frac[q] - f))
            m.insert(list(m).index(voice[k]), h)
        del kids
    if text.get("tempo") and measures:
        d = ET.Element("direction", {"placement": "above"})
        dt = ET.SubElement(d, "direction-type")
        met = ET.SubElement(dt, "metronome")
        ET.SubElement(met, "beat-unit").text = "quarter"
        ET.SubElement(met, "per-minute").text = str(text["tempo"])
        ET.SubElement(d, "sound", {"tempo": str(text["tempo"])})
        first = measures[0]
        at = next((i for i, el in enumerate(first) if el.tag == "note"), len(first))
        first.insert(at, d)
    if text.get("title"):
        work = root.find("work")
        if work is None:
            work = ET.Element("work")
            root.insert(0, work)
        wt = work.find("work-title")
        if wt is None:
            wt = ET.SubElement(work, "work-title")
        wt.text = text["title"]
    return {"chord_bars": chord_bars, "lyric_bars": lyric_bars, "syllables": placed,
            "lost_syllables": lost, "tempo": text.get("tempo"), "title": text.get("title")}


# ---------------------------------------------------------------- 길이 다시 매기기


def _respace(raw_gaps: list[float], beats: Fraction) -> list[Fraction]:
    """간격 비율 → 눈금 길이. 합이 beats가 되게 반올림 오차를 되돌린다."""
    total = sum(raw_gaps) or 1.0
    raw = [g / total * float(beats) for g in raw_gaps]
    out = [min(GRID, key=lambda g: abs(float(g) - r)) for r in raw]
    diff = beats - sum(out)
    for _ in range(40):
        if diff == 0:
            break
        if diff > 0:
            i = max(range(len(out)), key=lambda k: raw[k] - float(out[k]))
            out[i] += STEP
        else:
            cand = [k for k in range(len(out)) if out[k] > STEP]
            if not cand:
                break
            i = min(cand, key=lambda k: raw[k] - float(out[k]))
            out[i] -= STEP
        diff = beats - sum(out)
    return out


def repair_durations(root: ET.Element) -> dict:
    """모든 파트의 첫 성부 음표 길이를 가로 간격으로 다시 매긴다. 통계를 돌려준다."""
    parts_info = []
    n_measures = 0
    for part in root.findall("part"):
        divisions = 1
        beats = Fraction(4)
        changed = 0
        notes_n = 0
        measures = part.findall("measure")
        n_measures = max(n_measures, len(measures))

        # 「첫 음표부터 마디 끝까지」 폭의 중앙값 — 못갖춘마디는 이보다 좁다. 마디 폭
        # 자체는 줄 머리의 음자리표·박자표가 끼어 첫 마디가 넓게 잡히므로 쓰지 않는다
        def note_area(m: ET.Element) -> float:
            w = float(m.get("width") or 0)
            for el in m:
                if el.tag == "backup":
                    break
                if el.tag == "note" and el.find("chord") is None and el.find("grace") is None:
                    return w - float(el.get("default-x") or 0)
            return 0.0

        areas = sorted(a for a in (note_area(m) for m in measures) if a > 0)
        median_w = areas[len(areas) // 2] if areas else 0.0
        for mi, m in enumerate(measures):
            attrs = m.find("attributes")
            if attrs is not None:
                d = attrs.find("divisions")
                if d is not None:
                    divisions = int(d.text)
                    d.text = str(DIVISIONS)
                bt = attrs.find("time/beats")
                bty = attrs.find("time/beat-type")
                if bt is not None and bty is not None:
                    beats = Fraction(int(bt.text) * 4, int(bty.text))
            elif mi == 0:
                # 첫 마디에 divisions가 없으면 새로 적는다
                attrs = ET.Element("attributes")
                ET.SubElement(attrs, "divisions").text = str(DIVISIONS)
                m.insert(0, attrs)
            width = float(m.get("width") or 0)
            voice: list[ET.Element] = []
            for el in m:
                if el.tag == "backup":
                    break  # 첫 성부만 — 뒤 성부는 OMR이 지어낸 쉼표가 많다
                if el.tag != "note" or el.find("chord") is not None or el.find("grace") is not None:
                    continue
                voice.append(el)

            def rescale(el: ET.Element) -> None:
                dur = el.find("duration")
                if dur is not None and dur.text:
                    dur.text = str(int(round(int(dur.text) * DIVISIONS / divisions)))

            if not voice or width <= 0:
                # 간격을 모르면 눈금만 바꾼다
                for el in m:
                    if el.tag in ("note", "backup", "forward"):
                        rescale(el)
                continue
            xs = [float(el.get("default-x") or 0) for el in voice]
            gaps = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)] + [max(width - xs[-1], 1.0)]
            # 첫 마디는 못갖춘마디일 수 있다. OMR이 센 길이 합은 들보를 놓쳐 믿을 수 없으니
            # (「잊혀지는 것」 3박 마디를 5.5박으로 셌다) 마디 폭으로 박 수를 어림한다 —
            # 폭은 음 길이에 비례한다. 반 박 단위로 반올림, 한 마디를 넘지 않게
            target = beats
            area = width - xs[0]
            # 음표가 셋은 되어야 폭으로 박 수를 어림할 수 있다. 온음표 하나뿐인 마디(「동해의꿈」
            # 전주)는 폭이 음 길이와 상관없어, 온 마디를 반 마디로 줄였다
            if (
                mi == 0
                and median_w > 0
                and len(voice) >= 3
                and (m.get("implicit") == "yes" or area < median_w * 0.85)
            ):
                est = Fraction(int(round(float(beats) * area / median_w * 2)), 2)
                if 0 < est < beats:
                    target = est
            durs = _respace(gaps, target)
            chord_of: dict[int, list[ET.Element]] = defaultdict(list)
            cur = None
            for el in m:
                if el.tag == "backup":
                    break
                if el.tag != "note":
                    continue
                if el.find("chord") is not None and cur is not None:
                    chord_of[id(cur)].append(el)
                elif el.find("grace") is None:
                    cur = el
            for el, d in zip(voice, durs):
                old = Fraction(int(el.findtext("duration") or 0), divisions)
                if old != d:
                    changed += 1
                notes_n += 1
                for target_el in [el, *chord_of[id(el)]]:
                    dur = target_el.find("duration")
                    if dur is None:
                        dur = ET.SubElement(target_el, "duration")
                    dur.text = str(int(d * DIVISIONS))
                    typ, dots = TYPE_OF.get(d, ("quarter", 0))
                    t = target_el.find("type")
                    if t is None:
                        t = ET.SubElement(target_el, "type")
                    t.text = typ
                    for dot in target_el.findall("dot"):
                        target_el.remove(dot)
                    for _ in range(dots):
                        ET.SubElement(target_el, "dot")
                    tm = target_el.find("time-modification")
                    if tm is not None:
                        target_el.remove(tm)
            # 다른 성부의 backup/forward·음표 눈금도 바꿔 둔다
            in_voice = {id(e) for e in voice} | {id(c) for cs in chord_of.values() for c in cs}
            for el in m:
                if el.tag in ("backup", "forward") or (el.tag == "note" and id(el) not in in_voice):
                    rescale(el)
        parts_info.append({"id": part.get("id"), "notes": notes_n, "relaid": changed})
    return {"parts": parts_info, "measures": n_measures}
