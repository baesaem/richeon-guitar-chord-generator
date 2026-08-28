"""악보의 마디를 음원의 초에 잇는다.

악보는 「11마디 1박」으로 적혀 있고 음원은 「23.9초」로 흐른다. 둘을
이어야 커서가 노래를 따라간다. 이 일을 오디오-악보 정렬이라 부른다.

세 가지를 재 보고 이 방식을 골랐다.

1. 크로마 DTW — 표준 기법이지만 여기서는 오히려 어긋났다. 악보의
   전주는 노래가 아니라 기타가 치는 대목이라 보컬 트랙과 맞지 않고,
   부분열 DTW는 길을 싸게 만들려고 마디를 뭉개 버린다.
2. 음정 줄 맞추기 — 뽑아낸 멜로디가 성기고(부른 음의 15~30%) 흔들려
   50곳 중 9곳만 살아남았다. 게다가 2절에 가서 붙었다.
3. 코드 진행으로 앵커 보태기 — 앵커는 37개에서 69개로 늘었지만 오차는
   0.21초에서 0.65초로 나빠졌다. 코드가 바뀌는 자리를 음원 쪽이 한 박쯤
   이르게 잡아, 전체를 앞으로 끌어당겼다. 되돌렸다.
4. **박 격자 + 가사 앵커** — 이것을 쓴다.

음원에서 이미 뽑아 둔 박 격자는 고르고 음악적으로 맞다. 그러니
「간격」은 격자에 맡기고, 「악보를 격자의 어디에 얹을지」만 가사로
정한다. 두 자료의 잘하는 몫만 쓰는 셈이다.

곡이 조금씩 밀리는 것(옛 녹음은 흔하다)은 앵커를 옮겨 가며 중앙값을
다시 내어 따라간다.
"""

from __future__ import annotations

import difflib
import statistics as st
from dataclasses import dataclass

from .score_file import Score

#: 노래하지 않는 글자
_SKIP = set(" \t\n?!.,~·…-—:;/\\'\"()[]{}")

_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
#: 조표(♯ 개수, 음수면 ♭) → 으뜸음. 장조 기준.
_TONIC = {0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1,
          -1: 5, -2: 10, -3: 3, -4: 8, -5: 1, -6: 6, -7: 11}


@dataclass
class Grid:
    """음원의 박 격자. 박 번호(소수 가능) ↔ 초."""

    times: list[float]
    step: float

    @classmethod
    def of(cls, beats: list[dict]) -> "Grid":
        ts = sorted(b["t"] for b in beats)
        # 같은 자리에 두 번 찍힌 박을 걷어낸다
        ts = [t for i, t in enumerate(ts) if i == 0 or t - ts[i - 1] > 0.05]
        if len(ts) < 2:
            raise ValueError("박이 모자라 악보를 붙일 수 없습니다.")
        return cls(ts, (ts[-1] - ts[0]) / (len(ts) - 1))

    def sec(self, beat: float) -> float:
        if beat <= 0:
            return self.times[0] + beat * self.step
        i = int(beat)
        if i >= len(self.times) - 1:
            return self.times[-1] + (beat - (len(self.times) - 1)) * self.step
        a, b = self.times[i], self.times[i + 1]
        return a + (b - a) * (beat - i)

    def beat(self, sec: float) -> float:
        ts = self.times
        if sec <= ts[0]:
            return (sec - ts[0]) / self.step
        if sec >= ts[-1]:
            return len(ts) - 1 + (sec - ts[-1]) / self.step
        lo, hi = 0, len(ts) - 1
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if ts[mid] <= sec:
                lo = mid
            else:
                hi = mid
        return lo + (sec - ts[lo]) / (ts[lo + 1] - ts[lo])


def semitone_shift(score: Score, key: str) -> int:
    """악보와 음원의 조 차이(반음).

    기타 악보는 짚기 쉬운 조로 옮겨 적는 일이 흔하다 — 이 곡도 원곡은
    가장조인데 악보는 사장조다(카포 2프렛). 그대로 그리면 두 반음
    낮게 보인다.
    """
    root = (key or "").split(" ")[0].strip()
    if not root or root[0] not in _PC:
        return 0
    pc = _PC[root[0]]
    for ch in root[1:]:
        if ch in "#♯":
            pc += 1
        elif ch in "b♭":
            pc -= 1
    diff = (pc - _TONIC.get(score.fifths, 0)) % 12
    return diff - 12 if diff > 6 else diff


def _score_syllables(score: Score, verse: int = 0) -> list[tuple[str, float]]:
    """이 절의 가사를 (글자, 박) 줄로 편다.

    절마다 글자가 다르다. 2절을 1절 가사로 맞추려 들면 앵커가 반으로
    줄고, 화면에도 딴 글자가 뜬다.
    """
    out: list[tuple[str, float]] = []
    at = 0.0
    for bar in score.bars:
        for n in bar.notes:
            # 절마다 다른 대목만 따로 적혀 있다. 같은 대목은 1절 것을
            # 그대로 부르므로, 없으면 1절로 되돌아간다.
            syl = n.syls[verse] if verse < len(n.syls) and n.syls[verse] else n.syl
            for ch in syl:
                if ch not in _SKIP:
                    out.append((ch, at + n.beat))
        at += bar.beats
    return out


def _sung_syllables(words: list[dict]) -> list[tuple[str, float, bool]]:
    """부른 글자와 그 시각. 낱말 첫 글자만 실제로 찍힌 시각이다."""
    out: list[tuple[str, float, bool]] = []
    for w in words:
        chars = [c for c in str(w.get("text", "")) if c not in _SKIP]
        if not chars:
            continue
        start = float(w["start"])
        span = max(float(w["end"]) - start, 0.05) / len(chars)
        for i, ch in enumerate(chars):
            out.append((ch, start + i * span, i == 0))
    return out


def _anchors(
    score_syls: list[tuple[str, float]],
    sung: list[tuple[str, float, bool]],
    start: int,
) -> tuple[list[tuple[float, float]], int]:
    """sung의 start번째부터 악보 가사를 맞춰 (박, 초) 짝을 뽑는다."""
    a = "".join(c for c, _ in score_syls)
    b = "".join(c for c, _, _ in sung[start:])
    if not a or not b:
        return [], len(sung)
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    pairs: list[tuple[float, float]] = []
    end = start
    for i, j, size in sm.get_matching_blocks():
        if not size:
            continue
        for k in range(size):
            pairs.append((score_syls[i + k][1], sung[start + j + k][1]))
        end = start + j + size
    return pairs, end


def _keep(pairs: list[tuple[float, float]], grid: Grid) -> list[tuple[float, float]]:
    """(박, 옮긴 박). 뚝 떨어진 것은 잘못 붙은 것이니 버린다."""
    deltas = [(beat, grid.beat(sec) - beat) for beat, sec in pairs]
    if not deltas:
        return []
    mid = st.median([d for _, d in deltas])
    return [(b, d) for b, d in deltas if abs(d - mid) < 2.0]


def _delta_at(keep: list[tuple[float, float]], beat: float, window: float = 32.0) -> float:
    """이 자리 언저리의 옮긴 박. 곡이 밀리면 따라 밀린다."""
    near = [d for b, d in keep if abs(b - beat) <= window]
    return st.median(near if len(near) >= 3 else [d for _, d in keep])


def align(score: Score, result: dict, words: list[dict]) -> dict:
    """악보를 음원에 붙인다. 1절·2절처럼 되풀이하면 그만큼 여러 번.

    돌려주는 것:
      shift   악보를 몇 반음 올려 그려야 음원과 같은 소리인가
      passes  되풀이마다 마디별 시작·끝 시각
      checks  가사가 어긋난 마디(사람이 손볼 자리)
    """
    grid = Grid.of(result["beats"])
    shift = semitone_shift(score, result.get("key", ""))
    verses = [_score_syllables(score, v) for v in range(max(score.verses, 1))]
    verses = [v for v in verses if len(v) >= 8] or [_score_syllables(score, 0)]
    sung = _sung_syllables(words)

    passes: list[dict] = []
    checks: list[dict] = []
    at = 0

    # 악보 한 바퀴가 몇 박인지. 되풀이가 이보다 짧으면 더 볼 것이 없다.
    total = sum(b.beats for b in score.bars)

    while at < len(sung) and len(passes) < 8:
        # 이 바퀴가 몇 절인지 미리 알 수 없다(1절을 두 번 부르기도 한다).
        # 절마다 맞춰 보고 가장 잘 붙는 것을 고른다.
        best: tuple[int, list[tuple[float, float]], int] | None = None
        for vi, syls in enumerate(verses):
            pairs, end = _anchors(syls, sung, at)
            keep = _keep(pairs, grid)
            # 앵커가 한 군데 몰려 있으면 한 바퀴를 덮은 것이 아니다.
            # 개수만 보면 그런 토막이 이겨 버린다.
            spread = (keep[-1][0] - keep[0][0]) if len(keep) > 1 else 0.0
            if spread < total * 0.35:
                continue
            if best is None or len(keep) > len(best[1]):
                best = (vi, keep, end)
        if best is None:
            break
        verse, keep, at = best
        score_syls = verses[verse]
        if len(keep) < 8:
            break


        bars = []
        beat = 0.0
        for bar in score.bars:
            start = grid.sec(beat + _delta_at(keep, beat))
            end = grid.sec(beat + bar.beats + _delta_at(keep, beat + bar.beats))
            bars.append({
                "number": bar.number,
                "start": round(start, 3),
                "end": round(max(end, start + 0.05), 3),
            })
            beat += bar.beats

        passes.append({
            "verse": verse,
            "anchors": len(keep),
            "start": bars[0]["start"],
            "end": bars[-1]["end"],
            "bars": bars,
        })

        # 어긋난 마디 — 낱말 첫 글자만 견준다(나머지는 자 자체가 어림이다)
        firm = [(c, s) for c, s, f in sung if f]
        beat = 0.0
        for bar in score.bars:
            offs = []
            for n in bar.notes:
                if not n.syl:
                    continue
                t = grid.sec(beat + n.beat + _delta_at(keep, beat + n.beat))
                near = [s for c, s in firm if c == n.syl[0] and abs(s - t) < 2.0]
                if near:
                    offs.append(min(near, key=lambda s: abs(s - t)) - t)
            if offs and abs(st.median(offs)) > 0.6:
                checks.append({
                    "pass": len(passes) - 1,
                    "bar": bar.number,
                    "off": round(st.median(offs), 2),
                })
            beat += bar.beats

        if total <= 0:
            break

    # 되풀이끼리 겹치는 대목이 생긴다 — 악보의 후주와 다음 바퀴의 전주는
    # 음원에서 같은 자리(간주)이기 때문이다. 마디를 잘라내지는 않는다.
    # 잘라내면 「그림의 n번째 마디 = 악보의 n번째 마디」가 깨진다.
    # 대신 다음 바퀴가 시작하는 시각을 적어 두고, 화면이 그것으로 고른다.
    for a, b in zip(passes, passes[1:]):
        a["next"] = b["start"]

    return {"shift": shift, "passes": passes, "checks": checks}
