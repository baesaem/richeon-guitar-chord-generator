"""MusicXML 악보(.musicxml/.xml/.mxl)를 읽는다.

뮤즈스코어 파일(.mscz)과 담는 것은 같다 — 음높이·길이·가사·코드·
도돌이표. 다만 적는 말이 다르다. MusicXML은 악보 프로그램들이 서로
주고받으려고 만든 공용 형식이라, 시벨리우스·피날레·도리코·노테플라이트
어디서 내보낸 것이든 이 길로 들어온다.

읽어 낸 것을 score_file의 ScoreBar·ScoreNote 그대로 돌려준다. 그래야
정렬(score_align)도, 그리는 쪽(MelodyScore)도 손댈 것이 없다.

## 두 형식의 다른 점 가운데 손이 가는 것

- 길이를 `<divisions>`(4분음표를 몇으로 쪼개는가)로 적는다. 그래서
  나눗셈 한 번을 거쳐 「4분음표=1박」으로 바꾼다.
- 화음을 `<chord/>` 표시로 이어 적는다. 이 표시가 붙은 음표는 앞
  음표와 **같은 자리**에서 울린다 — 자리를 앞으로 밀면 안 된다.
- 성부가 갈릴 때 `<backup>`으로 자리를 되감는다.
- 되돌이·달세뇨를 `<barline>`과 `<sound>` 낱말로 적는다. 뮤즈스코어의
  이정표 이름(segno·coda·codab)으로 옮겨 두어야 expand가 알아본다.
"""

from __future__ import annotations

import io
import zipfile
import xml.etree.ElementTree as ET

from .score_file import (
    Score,
    ScoreBar,
    ScoreChord,
    ScoreNote,
    ScoreRest,
    expand,
)

#: 온음계 음이름 → 한 옥타브 안의 반음 자리
_STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

#: MusicXML의 화음 종류 → 사람이 읽는 꼬리표. `text`가 적혀 있으면
#: 그쪽이 먼저다 — 악보에 그렇게 적혀 있다는 뜻이니까.
_KIND = {
    "major": "", "minor": "m", "augmented": "aug", "diminished": "dim",
    "dominant": "7", "major-seventh": "maj7", "minor-seventh": "m7",
    "diminished-seventh": "dim7", "augmented-seventh": "aug7",
    "half-diminished": "m7♭5", "major-minor": "mMaj7",
    "major-sixth": "6", "minor-sixth": "m6",
    "dominant-ninth": "9", "major-ninth": "maj9", "minor-ninth": "m9",
    "suspended-second": "sus2", "suspended-fourth": "sus4",
    "power": "5", "none": "N.C.",
}


def _pitch_to_midi(el: ET.Element) -> int | None:
    p = el.find("pitch")
    if p is None:
        return None
    step = (p.findtext("step") or "C").strip().upper()
    try:
        octave = int(p.findtext("octave") or "4")
        alter = int(float(p.findtext("alter") or "0"))
    except ValueError:
        return None
    return (octave + 1) * 12 + _STEP.get(step, 0) + alter


def _accidental(alter: int) -> str:
    if alter > 0:
        return "♯" * alter
    if alter < 0:
        return "♭" * -alter
    return ""


def _harmony_label(el: ET.Element) -> str | None:
    root = el.find("root")
    if root is None:
        return None
    step = (root.findtext("root-step") or "").strip().upper()
    if not step:
        return None
    try:
        alter = int(float(root.findtext("root-alter") or "0"))
    except ValueError:
        alter = 0
    name = step + _accidental(alter)

    kind = el.find("kind")
    if kind is not None:
        text = (kind.get("text") or "").strip()
        name += text if text else _KIND.get((kind.text or "").strip(), "")

    bass = el.find("bass")
    if bass is not None:
        b = (bass.findtext("bass-step") or "").strip().upper()
        if b:
            try:
                ba = int(float(bass.findtext("bass-alter") or "0"))
            except ValueError:
                ba = 0
            name += "/" + b + _accidental(ba)
    return name


def _lyrics(el: ET.Element) -> dict[int, str]:
    """음표에 붙은 절별 가사. `<lyric number="2">`가 2절이다."""
    out: dict[int, str] = {}
    for ly in el.findall("lyric"):
        raw = (ly.get("number") or "1").strip()
        # number는 "1"일 때가 대부분이지만 "verse1"처럼 적히기도 한다
        digits = "".join(c for c in raw if c.isdigit())
        no = (int(digits) - 1) if digits else 0
        text = "".join(t.text or "" for t in ly.findall("text")).strip()
        if text:
            out[max(no, 0)] = text
    return out


def _directions(m_el: ET.Element) -> tuple[list[str], tuple[str, str, str] | None, float]:
    """마디에 붙은 이정표(세뇨·코다)와 되돌아가라는 지시, 그리고 빠르기.

    뮤즈스코어가 쓰는 이름으로 옮긴다 — expand가 그 이름으로 찾는다.
    「To Coda」 자리는 codab, 코다 본문은 coda다.
    """
    marks: list[str] = []
    jump: tuple[str, str, str] | None = None
    bpm = 0.0
    has_tocoda = False

    for d in m_el.iter("direction"):
        for dt in d.findall("direction-type"):
            if dt.find("segno") is not None:
                marks.append("segno")
            if dt.find("coda") is not None:
                marks.append("coda")
            words = " ".join((w.text or "") for w in dt.findall("words")).strip()
            low = words.lower().replace(".", "").replace(" ", "")
            if low.startswith("tocoda"):
                marks.append("codab")
                has_tocoda = True
            elif low == "fine":
                marks.append("fine")
        for snd in d.findall("sound"):
            if snd.get("tempo"):
                try:
                    bpm = float(snd.get("tempo") or 0)
                except ValueError:
                    pass
            if snd.get("segno"):
                marks.append("segno")
            if snd.get("coda"):
                marks.append("coda")
            if snd.get("tocoda"):
                marks.append("codab")
                has_tocoda = True
            if snd.get("fine"):
                marks.append("fine")
            if snd.get("dalsegno"):
                jump = ("segno", "codab" if has_tocoda else "fine", "coda")
            elif snd.get("dacapo"):
                jump = ("start", "codab" if has_tocoda else "fine", "coda")

    # 낱말로만 적힌 악보도 있다. 소리 지시가 없으면 글자로 알아본다.
    if jump is None:
        text = " ".join(
            (w.text or "") for w in m_el.iter("words")
        ).lower().replace(".", "").replace(" ", "")
        if "dalsegno" in text or text.startswith("ds"):
            jump = ("segno", "codab", "coda")
        elif "dacapo" in text or text.startswith("dc"):
            jump = ("start", "codab", "coda")

    # 같은 이정표가 두 번 적히는 일이 있다(글자와 소리 지시로 한 번씩)
    seen: list[str] = []
    for m in marks:
        if m not in seen:
            seen.append(m)
    return seen, jump, bpm


def parse(data: bytes | str) -> Score:
    """MusicXML 바이트(.mxl 압축본 포함)를 읽는다."""
    xml = _unpack(data)
    root = ET.fromstring(xml)
    if root.tag == "score-timewise":
        raise ValueError(
            "시간순(score-timewise) MusicXML은 아직 읽지 못합니다. "
            "악보 프로그램에서 파트순(partwise)으로 내보내 주세요."
        )
    if root.tag != "score-partwise":
        raise ValueError("MusicXML이 아닙니다.")

    title = (root.findtext("work/work-title") or "").strip()
    if not title:
        title = (root.findtext("movement-title") or "").strip()
    composer = ""
    for c in root.findall("identification/creator"):
        if (c.get("type") or "") in ("composer", ""):
            composer = (c.text or "").strip()
            break

    parts = root.findall("part")
    if not parts:
        raise ValueError("보표가 없습니다.")
    # 성부가 여럿이면 첫 파트(대개 멜로디)만 쓴다 — .mscz와 같은 규칙
    measures = parts[0].findall("measure")

    divisions = 1.0
    fifths = 0
    time_signature = "4/4"
    bar_beats = 4.0
    bpm = 0.0
    verses = 0
    bars: list[ScoreBar] = []
    #: 1·2번 괄호가 시작된 자리 → 몇 번째 바퀴에 부르는가
    open_ending: tuple[int, tuple[int, ...]] | None = None

    for index, m_el in enumerate(measures, 1):
        try:
            number = int((m_el.get("number") or str(index)).strip() or index)
        except ValueError:
            number = index

        for at_el in m_el.findall("attributes"):
            d = at_el.findtext("divisions")
            if d:
                try:
                    divisions = float(d) or 1.0
                except ValueError:
                    pass
            f = at_el.findtext("key/fifths")
            if f:
                try:
                    fifths = int(f)
                except ValueError:
                    pass
            beats = at_el.findtext("time/beats")
            beat_type = at_el.findtext("time/beat-type")
            if beats and beat_type:
                time_signature = f"{beats}/{beat_type}"
                try:
                    bar_beats = float(beats) * 4.0 / float(beat_type)
                except (ValueError, ZeroDivisionError):
                    pass

        bar = ScoreBar(number=number, beats=bar_beats)
        marks, jump, tempo = _directions(m_el)
        bar.markers = tuple(marks)
        bar.jump = jump
        if tempo:
            bpm = tempo
        # 다카포는 「처음으로」다. 첫 마디에 이정표를 세워 둔다.
        if index == 1:
            bar.markers = tuple(["start", *bar.markers])

        for bl in m_el.findall("barline"):
            rep = bl.find("repeat")
            if rep is not None:
                if (rep.get("direction") or "") == "forward":
                    bar.start_repeat = True
                else:
                    try:
                        bar.end_repeat = max(int(rep.get("times") or "2"), 2)
                    except ValueError:
                        bar.end_repeat = 2
            end = bl.find("ending")
            if end is not None:
                kind = (end.get("type") or "").strip()
                nums = tuple(
                    int(n) for n in (end.get("number") or "").replace(" ", "").split(",")
                    if n.isdigit()
                )
                if kind == "start":
                    open_ending = (len(bars), nums)
                elif open_ending is not None:
                    # 괄호가 덮은 마디 수를 이제야 안다. 시작한 자리에 적는다.
                    # 한 마디짜리 괄호는 시작과 끝이 같은 마디라, 아직
                    # 목록에 넣지 않은 지금 마디가 그 자리다.
                    at_bar, at_nums = open_ending
                    target = bar if at_bar >= len(bars) else bars[at_bar]
                    target.volta = (at_nums, len(bars) - at_bar + 1)
                    open_ending = None

        at = 0.0
        prev_at = 0.0        # 화음(<chord/>)이 되돌아갈 자리
        for el in m_el:
            tag = el.tag

            if tag == "harmony":
                label = _harmony_label(el)
                if label:
                    bar.chords.append(ScoreChord(beat=at, label=label))
                continue

            if tag == "backup":
                at = max(at - _beats(el, divisions), 0.0)
                continue
            if tag == "forward":
                at += _beats(el, divisions)
                continue

            if tag != "note":
                continue

            # 꾸밈음은 길이가 없다. 자리를 밀지 않고 지나친다.
            if el.find("grace") is not None:
                continue

            dur = _beats(el, divisions)
            in_chord = el.find("chord") is not None
            if in_chord:
                at = prev_at

            rest = el.find("rest")
            if rest is not None:
                if (rest.get("measure") or "").lower() == "yes":
                    bar.rests.append(ScoreRest(beat=at, dur=bar.beats))
                    at = bar.beats
                else:
                    bar.rests.append(
                        ScoreRest(beat=at, dur=dur, tuplet=_tuplet(el))
                    )
                    at += dur
                prev_at = at
                continue

            midi = _pitch_to_midi(el)
            if midi is None:
                at += dur
                prev_at = at
                continue

            # 앞 음에서 이어진 음인가
            tied = any(
                (t.get("type") or "") == "stop" for t in el.findall("tie")
            ) or any(
                (t.get("type") or "") == "stop"
                for t in el.findall("notations/tied")
            )

            if in_chord:
                # 같은 자리의 화음. 우리는 가장 높은 음을 멜로디로 삼는다.
                if bar.notes and bar.notes[-1].beat == at:
                    bar.notes[-1].midi = max(bar.notes[-1].midi, midi)
                at = prev_at + dur
                continue

            syls = _lyrics(el)
            if syls:
                verses = max(verses, max(syls) + 1)

            if tied and bar.notes and not syls:
                # 새 음표를 만들지 않고 앞 음을 늘인다 — 같은 음을 두 번
                # 치는 것처럼 보이면 안 된다.
                bar.notes[-1].dur += dur
                prev_at = at
                at += dur
                continue

            bar.notes.append(
                ScoreNote(
                    beat=at,
                    dur=dur,
                    midi=midi,
                    syl=syls.get(0, ""),
                    syls=[syls.get(v, "") for v in range(max(syls, default=-1) + 1)],
                    tied=tied,
                    head=dur,
                    tuplet=_tuplet(el),
                )
            )
            prev_at = at
            at += dur

        bar.filled = at
        # 못갖춘마디(들어가는 마디)는 적힌 박자보다 짧다. 채워진 만큼이 길이다.
        if (m_el.get("implicit") or "").lower() == "yes" and at > 0:
            bar.beats = at

        bar.notes.sort(key=lambda n: n.beat)
        bar.rests.sort(key=lambda r: r.beat)
        bar.chords.sort(key=lambda c: c.beat)
        bars.append(bar)

    # 「어디까지 부르고 코다로 넘어가나」는 악보 전체를 봐야 안다.
    # D.S.가 적힌 마디에는 To Coda가 없으므로, 다 읽은 뒤에 맞춘다.
    labels = {m for b in bars for m in b.markers}
    for b in bars:
        if not b.jump:
            continue
        target, until, cont = b.jump
        if until not in labels:
            until = "codab" if "codab" in labels else ("fine" if "fine" in labels else "")
        b.jump = (target, until, cont if cont in labels else "")

    return Score(
        title=title,
        composer=composer,
        source="",
        fifths=fifths,
        time_signature=time_signature,
        bpm=round(bpm, 2),
        bars=bars,
        verses=max(verses, 1),
        play=expand(bars),
    )


def _beats(el: ET.Element, divisions: float) -> float:
    """<duration>을 4분음표=1박으로 바꾼다."""
    raw = el.findtext("duration")
    if not raw:
        return 0.0
    try:
        return float(raw) / divisions
    except (ValueError, ZeroDivisionError):
        return 0.0


def _tuplet(el: ET.Element) -> float:
    """잇단음표 비율. 셋잇단이면 2/3."""
    tm = el.find("time-modification")
    if tm is None:
        return 1.0
    try:
        normal = float(tm.findtext("normal-notes") or "1")
        actual = float(tm.findtext("actual-notes") or "1")
        return normal / actual if actual else 1.0
    except ValueError:
        return 1.0


def _unpack(data: bytes | str) -> str:
    """.mxl(zip)이면 속의 악보를 꺼낸다."""
    if isinstance(data, str):
        return data
    if data[:2] != b"PK":
        return data.decode("utf-8-sig")

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        # 어느 파일이 본문인지는 META-INF/container.xml이 가리킨다
        if "META-INF/container.xml" in names:
            box = ET.fromstring(z.read("META-INF/container.xml"))
            for rf in box.iter("rootfile"):
                path = rf.get("full-path")
                if path and path in names:
                    return z.read(path).decode("utf-8-sig")
        for name in names:
            if name.lower().endswith((".musicxml", ".xml")) and not name.startswith(
                "META-INF"
            ):
                return z.read(name).decode("utf-8-sig")
    raise ValueError("압축 안에서 악보를 찾지 못했습니다.")
