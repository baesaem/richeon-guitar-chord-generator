"""종이 악보(PDF·그림) → MusicXML — Audiveris로 음표·마디를 읽는다.

음원 채보는 오류가 많고 디지털 악보(.mscz)는 구하기 어렵다(강사님). 인쇄 악보를
Audiveris(OMR)로 읽으면 마디 수·음높이는 거의 정확하다 — 「잊혀지는 것」 PDF에서
68/68마디, 음높이 99%. 다만 들보(8분음표 묶음)를 통째로 놓쳐 8분음표가 4분음표로
나왔다(해상도·들보 두께 지정으로도 안 됨). 인쇄 악보는 음 길이에 비례해 음표
간격을 두므로, 마디 안 **가로 간격 비율**로 길이를 다시 매기고 합을 박자표에
맞추면 95%가 돌아온다(마디 60/68 완전 일치).

코드 기호·가사·되돌이 글자는 OCR을 켜도 못 믿을 수준이라(코드 44/67, 가사
뒤섞임, 도돌이표 0) 여기서는 손대지 않는다 — 앱의 AI 그림 읽기가 맡는다.
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import zipfile
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


def audiveris_exe() -> Path | None:
    for p in (settings.audiveris_exe, r"C:\Program Files\Audiveris\Audiveris.exe"):
        if p and Path(p).exists():
            return Path(p)
    return None


def available() -> bool:
    return audiveris_exe() is not None


async def recognize(source: Path) -> dict:
    """PDF·그림 → {"xml": MusicXML 글, "parts": [...], "measures": n}. 실패하면 던진다."""
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
        stats = repair_durations(root)
        xml = ET.tostring(root, encoding="unicode")
        return {"xml": xml, **stats}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _read_mxl(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and not n.startswith("META-INF"))
        return ET.fromstring(z.read(name))


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
                attrs = ET.SubElement(m, "attributes")
                ET.SubElement(attrs, "divisions").text = str(DIVISIONS)
                m.remove(attrs)
                m.insert(0, attrs)
            width = float(m.get("width") or 0)
            voice: list[ET.Element] = []
            for el in m:
                if el.tag == "backup":
                    break  # 첫 성부만 — 뒤 성부는 OMR이 지어낸 쉼표가 많다
                if el.tag != "note" or el.find("chord") is not None or el.find("grace") is not None:
                    continue
                voice.append(el)
            if not voice or width <= 0:
                # 간격을 모르면 눈금만 바꾼다
                for el in m.iter("note"):
                    dur = el.find("duration")
                    if dur is not None and dur.text:
                        dur.text = str(int(round(int(dur.text) * DIVISIONS / divisions)))
                for el in m.iter("backup"):
                    dur = el.find("duration")
                    if dur is not None and dur.text:
                        dur.text = str(int(round(int(dur.text) * DIVISIONS / divisions)))
                for el in m.iter("forward"):
                    dur = el.find("duration")
                    if dur is not None and dur.text:
                        dur.text = str(int(round(int(dur.text) * DIVISIONS / divisions)))
                continue
            xs = [float(el.get("default-x") or 0) for el in voice]
            gaps = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)] + [max(width - xs[-1], 1.0)]
            # 첫 마디는 못갖춘마디일 수 있다. OMR이 센 길이 합은 들보를 놓쳐 믿을 수 없으니
            # (「잊혀지는 것」 3박 마디를 5.5박으로 셌다) 마디 폭으로 박 수를 어림한다 —
            # 폭은 음 길이에 비례한다. 반 박 단위로 반올림, 한 마디를 넘지 않게
            target = beats
            area = width - xs[0]
            if mi == 0 and median_w > 0 and (m.get("implicit") == "yes" or area < median_w * 0.85):
                est = Fraction(int(round(float(beats) * area / median_w * 2)), 2)
                if 0 < est < beats:
                    target = est
            durs = _respace(gaps, target)
            for el, d in zip(voice, durs):
                old = Fraction(int(el.findtext("duration") or 0), divisions)
                if old != d:
                    changed += 1
                notes_n += 1
                dur = el.find("duration")
                if dur is None:
                    dur = ET.SubElement(el, "duration")
                dur.text = str(int(d * DIVISIONS))
                typ, dots = TYPE_OF.get(d, ("quarter", 0))
                t = el.find("type")
                if t is None:
                    t = ET.SubElement(el, "type")
                t.text = typ
                for dot in el.findall("dot"):
                    el.remove(dot)
                for _ in range(dots):
                    ET.SubElement(el, "dot")
                tm = el.find("time-modification")
                if tm is not None:
                    el.remove(tm)
            # 다른 성부의 backup/forward 눈금도 바꿔 둔다
            for el in m:
                if el.tag in ("backup", "forward"):
                    dur = el.find("duration")
                    if dur is not None and dur.text:
                        dur.text = str(int(round(int(dur.text) * DIVISIONS / divisions)))
                elif el.tag == "note" and el not in voice:
                    dur = el.find("duration")
                    if dur is not None and dur.text:
                        dur.text = str(int(round(int(dur.text) * DIVISIONS / divisions)))
        parts_info.append({"id": part.get("id"), "notes": notes_n, "relaid": changed})
    return {"parts": parts_info, "measures": n_measures}
