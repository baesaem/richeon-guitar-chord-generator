"""뮤즈스코어 악보 파일(.mscz/.mscx)을 읽는다.

보컬에서 딴 멜로디는 부른 음의 15~30%밖에 잡히지 않는다. 같은 음을
이어 부른 대목을 하나로 뭉치고 약한 소리를 버리기 때문인데, 설정을
손봐서 메울 차이가 아니다. 그래서 **악보를 진실로 삼는다**.

여기서 하는 일은 악보를 「마디와 박」의 목록으로 바꾸는 것까지다.
그것을 음원의 「초」에 잇는 일은 align.py가 맡는다.

.mscz는 .mscx(뮤즈스코어 XML)를 담은 zip이다. MusicXML이 아니라
뮤즈스코어 고유 형식이지만, 필요한 것(음높이·길이·가사·코드)은 모두
평범한 XML 요소라 바로 읽힌다 — 뮤즈스코어를 깔지 않아도 된다.
"""

from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Iterable

# 음길이(4분음표를 1로 셈)
_DUR = {
    "breve": 8.0, "whole": 4.0, "half": 2.0, "quarter": 1.0,
    "eighth": 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625,
    "128th": 0.03125,
}

# 뮤즈스코어의 tpc(온음계 음이름 번호) → 음이름. 코드 뿌리를 이것으로 적는다.
_TPC = [
    "F♭♭", "C♭♭", "G♭♭", "D♭♭", "A♭♭", "E♭♭", "B♭♭",
    "F♭", "C♭", "G♭", "D♭", "A♭", "E♭", "B♭",
    "F", "C", "G", "D", "A", "E", "B",
    "F♯", "C♯", "G♯", "D♯", "A♯", "E♯", "B♯",
    "F♯♯", "C♯♯", "G♯♯", "D♯♯", "A♯♯", "E♯♯", "B♯♯",
]


@dataclass
class ScoreNote:
    """악보의 음표 하나. 시각이 아니라 마디 안의 박 자리로 적는다."""

    beat: float          # 마디 첫머리부터 몇 박째(4분음표 단위)
    dur: float           # 몇 박(붙임줄로 이어진 만큼 합쳐 둔다)
    midi: int
    syl: str = ""        # 이 음에 붙는 가사 한 음절. 없으면 빈 문자열
    tied: bool = False   # 앞 음에서 이어진 음인가(가사를 새로 얹지 않는다)


@dataclass
class ScoreChord:
    beat: float
    label: str


@dataclass
class ScoreBar:
    number: int
    beats: float                                  # 이 마디의 길이(박). 못갖춘마디는 짧다
    notes: list[ScoreNote] = field(default_factory=list)
    chords: list[ScoreChord] = field(default_factory=list)
    #: 음표·쉼표로 실제 채워진 길이(박). beats와 다르면 읽다가 어긋난 것이다
    filled: float = 0.0


@dataclass
class Score:
    title: str
    composer: str
    source: str
    fifths: int          # 조표. 양수면 ♯ 개수, 음수면 ♭ 개수
    time_signature: str
    bpm: float
    bars: list[ScoreBar]
    verses: int          # 가사 절 수

    @property
    def sung_bars(self) -> tuple[int, int]:
        """가사가 붙은 첫 마디와 마지막 마디. 전주·후주를 가늠하는 데 쓴다."""
        sung = [b.number for b in self.bars if any(n.syl for n in b.notes)]
        return (sung[0], sung[-1]) if sung else (0, 0)


def _text(el: ET.Element | None, tag: str, default: str = "") -> str:
    if el is None:
        return default
    v = el.findtext(tag)
    return default if v is None else v


def _fraction(s: str | None) -> float | None:
    """뮤즈스코어의 「3/4」 같은 분수를 박 수로. 못갖춘마디 길이에 쓴다."""
    if not s or "/" not in s:
        return None
    a, b = s.split("/", 1)
    try:
        return float(a) / float(b) * 4.0
    except ValueError:
        return None


def _chord_label(el: ET.Element) -> str | None:
    """<Harmony>를 사람이 읽는 코드 이름으로. 분수코드는 /베이스를 붙인다."""
    root = el.findtext("root")
    if root is None:
        return None
    try:
        name = _TPC[int(root) + 1]
    except (ValueError, IndexError):
        return None
    name += (el.findtext("name") or "").strip()
    base = el.findtext("bass") or el.findtext("base")
    if base is not None:
        try:
            name += "/" + _TPC[int(base) + 1]
        except (ValueError, IndexError):
            pass
    return name


def parse(data: bytes | str) -> Score:
    """.mscz(zip) 또는 .mscx(xml) 바이트를 읽는다."""
    if isinstance(data, str):
        xml = data
    elif data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            inner = next(n for n in z.namelist() if n.endswith(".mscx"))
            xml = z.read(inner).decode("utf-8")
    else:
        xml = data.decode("utf-8")

    root = ET.fromstring(xml)
    score_el = root.find("Score")
    if score_el is None:
        raise ValueError("악보를 찾을 수 없습니다. 뮤즈스코어 파일이 맞습니까?")

    meta = {m.get("name"): (m.text or "") for m in score_el.findall("metaTag")}

    staves = score_el.findall("Staff")
    if not staves:
        raise ValueError("보표가 없습니다.")
    # 여러 성부가 있으면 첫 보표(대개 멜로디)만 쓴다
    measures = staves[0].findall("Measure")

    fifths = 0
    time_signature = "4/4"
    bpm = 0.0
    bar_beats = 4.0
    verses = 0
    bars: list[ScoreBar] = []

    for index, m_el in enumerate(measures, 1):
        number = int(m_el.get("number") or index)
        length = _fraction(m_el.get("len"))
        bar = ScoreBar(number=number, beats=length if length else bar_beats)

        # 마디 안의 자리(박). 성부가 여럿이면 각 voice가 처음부터 다시 센다.
        for voice in m_el.findall("voice"):
            at = 0.0
            tuplet_ratio = 1.0
            pending_lyrics: list[tuple[int, str]] = []

            for el in voice:
                tag = el.tag

                if tag == "KeySig":
                    fifths = int(_text(el, "accidental", "0") or 0)
                    continue
                if tag == "TimeSig":
                    n = _text(el, "sigN", "4")
                    d = _text(el, "sigD", "4")
                    time_signature = f"{n}/{d}"
                    bar_beats = float(n) * 4.0 / float(d)
                    if length is None:
                        bar.beats = bar_beats
                    continue
                if tag == "Tempo":
                    # 뮤즈스코어는 「초당 4분음표」로 적는다
                    try:
                        bpm = float(_text(el, "tempo", "0")) * 60.0
                    except ValueError:
                        pass
                    continue
                if tag == "Tuplet":
                    try:
                        normal = float(_text(el, "normalNotes", "1"))
                        actual = float(_text(el, "actualNotes", "1"))
                        tuplet_ratio = normal / actual if actual else 1.0
                    except ValueError:
                        tuplet_ratio = 1.0
                    continue
                if tag == "endTuplet":
                    tuplet_ratio = 1.0
                    continue
                if tag == "Harmony":
                    label = _chord_label(el)
                    if label:
                        bar.chords.append(ScoreChord(beat=at, label=label))
                    continue

                if tag == "Rest":
                    dt = _text(el, "durationType", "quarter")
                    if dt == "measure":
                        at = bar.beats
                    else:
                        at += _DUR.get(dt, 1.0) * tuplet_ratio * _dot_factor(el)
                    continue

                if tag != "Chord":
                    continue

                dt = _text(el, "durationType", "quarter")
                dur = _DUR.get(dt, 1.0) * tuplet_ratio * _dot_factor(el)

                # 화음이면 가장 높은 음이 멜로디다
                pitches = [int(p) for p in
                           (n.findtext("pitch") for n in el.findall("Note"))
                           if p is not None]
                if not pitches:
                    at += dur
                    continue
                midi = max(pitches)

                tied = any(
                    sp.get("type") == "Tie" and sp.find("prev") is not None
                    for note in el.findall("Note")
                    for sp in note.findall("Spanner")
                )

                syl = ""
                for ly in el.findall("Lyrics"):
                    no = int(_text(ly, "no", "0") or 0)
                    verses = max(verses, no + 1)
                    if no == 0:
                        syl = (ly.findtext("text") or "").strip()

                if tied and bar.notes and not syl:
                    # 앞 음에서 이어진 음. 새 음표를 만들지 않고 길이만 늘인다.
                    bar.notes[-1].dur += dur
                    at += dur
                    continue

                bar.notes.append(
                    ScoreNote(beat=at, dur=dur, midi=midi, syl=syl, tied=tied)
                )
                at += dur

            bar.filled = max(bar.filled, at)

        bar.notes.sort(key=lambda n: n.beat)
        bar.chords.sort(key=lambda c: c.beat)
        bars.append(bar)

    return Score(
        title=meta.get("workTitle", "") or "",
        composer=meta.get("composer", "") or "",
        source=meta.get("source", "") or "",
        fifths=fifths,
        time_signature=time_signature,
        bpm=round(bpm, 2),
        bars=bars,
        verses=max(verses, 1),
    )


def _dot_factor(el: ET.Element) -> float:
    """점음표. 점 하나면 1.5배, 둘이면 1.75배."""
    dots = el.findtext("dots")
    n = int(dots) if dots and dots.isdigit() else len(el.findall("dots"))
    return 2.0 - 0.5 ** n if n else 1.0


def to_dict(score: Score) -> dict:
    """앱으로 넘길 모양. 마디마다 음표·코드를 박 자리로 담는다."""
    return {
        "title": score.title,
        "composer": score.composer,
        "source": score.source,
        "fifths": score.fifths,
        "time_signature": score.time_signature,
        "bpm": score.bpm,
        "verses": score.verses,
        "bars": [
            {
                "number": b.number,
                "beats": round(b.beats, 4),
                "chords": [{"beat": round(c.beat, 4), "label": c.label} for c in b.chords],
                "notes": [
                    {
                        "beat": round(n.beat, 4),
                        "dur": round(n.dur, 4),
                        "midi": n.midi,
                        "syl": n.syl,
                        # 앞 마디에서 이어진 음. 머리를 다시 그리지 않는다 —
                        # 새로 친 음처럼 보이면 같은 음을 두 번 치게 된다.
                        "tie": n.tied,
                    }
                    for n in b.notes
                ],
            }
            for b in score.bars
        ],
    }
