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
    dur: float           # 몇 박 울리는가(붙임줄로 이어진 만큼 합쳐 둔다)
    midi: int
    syl: str = ""        # 1절 가사 한 음절. 없으면 빈 문자열
    #: 절마다의 가사. syls[0]이 1절이다. 2절을 부를 때 1절 글자가 뜨면
    #: 화면과 노래가 딴소리를 한다.
    syls: list[str] = field(default_factory=list)
    tied: bool = False   # 앞 음에서 이어진 음인가(가사를 새로 얹지 않는다)
    #: 악보에 **적힌** 길이(박). dur과 다를 수 있다 — 붙임줄로 이어지면
    #: 울리는 길이는 늘어나지만 그리는 음표 모양은 첫 마디의 것이다.
    head: float = 1.0
    #: 잇단음표 비율(셋잇단이면 2/3). 모양을 정할 때 이 값으로 되돌린다.
    tuplet: float = 1.0


@dataclass
class ScoreChord:
    beat: float
    label: str


@dataclass
class ScoreRest:
    """쉼표. 그리지 않으면 어디서 쉬는지 알 수 없다."""

    beat: float
    dur: float
    tuplet: float = 1.0


@dataclass
class ScoreBar:
    number: int
    beats: float                                  # 이 마디의 길이(박). 못갖춘마디는 짧다
    notes: list[ScoreNote] = field(default_factory=list)
    rests: list[ScoreRest] = field(default_factory=list)
    chords: list[ScoreChord] = field(default_factory=list)
    #: 음표·쉼표로 실제 채워진 길이(박). beats와 다르면 읽다가 어긋난 것이다
    filled: float = 0.0
    #: 되돌아 시작하는 자리(𝄆)
    start_repeat: bool = False
    #: 되돌아가라는 자리(𝄇). 몇 번 부르는지(2면 두 번)
    end_repeat: int = 0
    #: 1·2번 괄호. 몇 번째 바퀴에 부르는가와, 괄호가 덮는 마디 수
    volta: tuple[tuple[int, ...], int] | None = None
    #: 이 마디에 붙은 이정표(segno·coda·fine 따위)
    markers: tuple[str, ...] = ()
    #: 되돌아가라는 지시. (어디로, 어디까지, 그다음 어디로)
    jump: tuple[str, str, str] | None = None


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
    #: 실제로 부르는 차례(bars의 자리 번호). 도돌이표를 편 것이다.
    play: list[int] = field(default_factory=list)

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
        marks: list[str] = []
        for mk in m_el.iter("Marker"):
            label = (mk.findtext("label") or "").strip()
            if label:
                marks.append(label)
        bar.markers = tuple(marks)
        jmp = next(iter(m_el.iter("Jump")), None)
        if jmp is not None:
            bar.jump = (
                (jmp.findtext("jumpTo") or "").strip(),
                (jmp.findtext("playUntil") or "").strip(),
                (jmp.findtext("continueAt") or "").strip(),
            )
        if m_el.find("startRepeat") is not None:
            bar.start_repeat = True
        # <endRepeat/>는 속이 빈 요소로 나오기도 한다(두 번 부르라는 뜻).
        # findtext로 보면 None이라 없는 것으로 읽힌다 — find로 봐야 한다.
        end_rep = m_el.find("endRepeat")
        if end_rep is not None:
            try:
                bar.end_repeat = max(int((end_rep.text or "2").strip()), 2)
            except ValueError:
                bar.end_repeat = 2

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
                if tag == "Spanner" and el.get("type") == "Volta":
                    v = el.find("Volta")
                    span = 1
                    nxt = el.find("next/location/measures")
                    if nxt is not None and nxt.text:
                        try:
                            span = max(int(nxt.text), 1)
                        except ValueError:
                            span = 1
                    endings: tuple[int, ...] = ()
                    if v is not None:
                        raw = (v.findtext("endings") or "").replace(" ", "")
                        nums = [int(n) for n in raw.split(",") if n.isdigit()]
                        endings = tuple(nums)
                    bar.volta = (endings, span)
                    continue
                if tag == "Harmony":
                    label = _chord_label(el)
                    if label:
                        bar.chords.append(ScoreChord(beat=at, label=label))
                    continue

                if tag == "Rest":
                    dt = _text(el, "durationType", "quarter")
                    if dt == "measure":
                        bar.rests.append(ScoreRest(beat=at, dur=bar.beats))
                        at = bar.beats
                    else:
                        d = _DUR.get(dt, 1.0) * tuplet_ratio * _dot_factor(el)
                        bar.rests.append(
                            ScoreRest(beat=at, dur=d, tuplet=tuplet_ratio)
                        )
                        at += d
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

                syls: dict[int, str] = {}
                for ly in el.findall("Lyrics"):
                    no = int(_text(ly, "no", "0") or 0)
                    verses = max(verses, no + 1)
                    text = (ly.findtext("text") or "").strip()
                    if text:
                        syls[no] = text
                syl = syls.get(0, "")

                if tied and bar.notes and not syls:
                    # 앞 음에서 이어진 음. 새 음표를 만들지 않고 길이만 늘인다.
                    bar.notes[-1].dur += dur
                    at += dur
                    continue

                bar.notes.append(
                    ScoreNote(
                        beat=at, dur=dur, midi=midi, syl=syl, tied=tied,
                        head=dur, tuplet=tuplet_ratio,
                        syls=[syls.get(v, "") for v in range(max(syls, default=-1) + 1)],
                    )
                )
                at += dur

            bar.filled = max(bar.filled, at)

        bar.notes.sort(key=lambda n: n.beat)
        bar.rests.sort(key=lambda r: r.beat)
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
        play=expand(bars),
    )


def expand(bars: list[ScoreBar]) -> list[int]:
    """도돌이표를 펴서 **실제로 부르는 차례**를 만든다.

    악보는 되풀이를 접어 적는다. 「하얀나비」는 57마디로 적혀 있지만
    D.S. al Coda 때문에 실제로는 102마디를 부른다 — 접힌 채로 음원에
    맞추면 곡의 절반부터 어긋난다.

    다루는 것: 도돌이표(𝄆 𝄇), 1·2번 괄호, 다카포·달세뇨와 코다.
    알아보지 못하는 지시는 그냥 지나친다 — 펴다가 멈추느니 적힌 차례
    그대로 부르는 편이 낫다.
    """
    if not bars:
        return []

    marker_at: dict[str, int] = {}
    for i, bar in enumerate(bars):
        for label in bar.markers:
            marker_at.setdefault(label, i)

    play: list[int] = []
    played: dict[int, int] = {}   # 되돌이 끝 마디 → 지나간 횟수
    jumped: set[int] = set()
    start = 0
    until: str = ""
    cont: str = ""
    i = 0
    guard = 0

    while 0 <= i < len(bars) and guard < len(bars) * 12:
        guard += 1
        bar = bars[i]

        # 「여기까지」에 닿으면 코다로 건너뛴다
        if until and until in bar.markers:
            if cont and cont in marker_at:
                i = marker_at[cont]
                until = cont = ""
                continue
            break

        if bar.start_repeat:
            start = i

        # 1·2번 괄호: 이번 바퀴에 부르지 않는 괄호는 통째로 건너뛴다
        if bar.volta:
            endings, span = bar.volta
            turn = played.get(_next_end(bars, i), 0) + 1
            if endings and turn not in endings:
                i += span
                continue

        play.append(i)

        if bar.end_repeat and played.get(i, 0) + 1 < bar.end_repeat:
            played[i] = played.get(i, 0) + 1
            i = start
            continue

        if bar.jump and i not in jumped:
            jumped.add(i)
            target, until, cont = bar.jump
            if target in marker_at:
                i = marker_at[target]
                continue
            until = cont = ""

        i += 1

    return play


def _next_end(bars: list[ScoreBar], i: int) -> int:
    """이 자리 뒤에 오는 되돌이 끝 마디. 괄호가 몇 번째 바퀴인지 세는 데 쓴다."""
    for j in range(i, len(bars)):
        if bars[j].end_repeat:
            return j
    return i


def _dot_factor(el: ET.Element) -> float:
    """점음표. 점 하나면 1.5배, 둘이면 1.75배."""
    dots = el.findtext("dots")
    n = int(dots) if dots and dots.isdigit() else len(el.findall("dots"))
    return 2.0 - 0.5 ** n if n else 1.0


def to_dict(score: Score) -> dict:
    """앱으로 넘길 모양. 마디마다 음표·코드를 박 자리로 담는다."""
    return {
        "play": score.play,
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
                "rests": [
                    {
                        "beat": round(r.beat, 4),
                        "dur": round(r.dur, 4),
                        "tuplet": round(r.tuplet, 4),
                    }
                    for r in b.rests
                ],
                "notes": [
                    {
                        "beat": round(n.beat, 4),
                        "dur": round(n.dur, 4),
                        "midi": n.midi,
                        "syl": n.syl,
                        "syls": n.syls,
                        "head": round(n.head, 4),
                        "tuplet": round(n.tuplet, 4),
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
