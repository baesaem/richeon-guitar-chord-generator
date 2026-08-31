"""박이 고르지 않은 대목을 바로잡는다.

박 찾기는 곡 전체에서 같은 잣대를 쓰지 못할 때가 있다. 이장희 「그건 너」는
0.37초 간격으로 세다가 30~54초 사이만 0.74초로 세었다 — 그 바람에 앞 열여덟
마디는 1.4초, 열아홉째 마디부터는 2.9초가 되어 진행 바가 갑자기 느려졌다.

곡의 빠르기는 대개 한결같다. 그러니 **가장 잦은 간격**을 잣대로 삼고,
그보다 두 배쯤 벌어진 곳에는 박을 끼워 넣고, 절반쯤 좁은 곳에서는 박을
덜어 낸다. 잣대에 맞는 자리는 건드리지 않으므로 박의 위상(어디가 첫 박인지)은
그대로 남는다.

빠르기 자체를 두 배·절반으로 보는 일은 따로 둔다(scale). 어느 쪽이 옳은지는
악보를 보아야 알 수 있고, 그것은 사람이 정할 몫이다.

되돌리기 쉬운 일만 한다 — 마디 번호를 다시 매길 뿐이니, 곡을 다시 분석하면
처음 상태로 돌아온다.
"""

from __future__ import annotations

import statistics


def _gaps(times: list[float]) -> list[float]:
    return [times[i + 1] - times[i] for i in range(len(times) - 1)]


def _renumber(times: list[float], beats: list[dict], per_bar: int) -> list[dict]:
    """시각 목록에 마디·박 번호를 다시 매긴다. 세기는 첫 박부터."""
    out: list[dict] = []
    bar, beat = 1, 0
    for t in times:
        beat += 1
        if beat > per_bar:
            beat, bar = 1, bar + 1
        out.append({"t": round(t, 3), "beat": beat, "bar": bar})
    return out


def even(beats: list[dict], per_bar: int = 4) -> tuple[list[dict], int]:
    """벌어진 곳은 메우고 좁은 곳은 덜어 고른 박으로. (새 박, 고친 자리 수)"""
    times = [float(b["t"]) for b in beats]
    if len(times) < 16:
        return beats, 0

    unit = statistics.median(_gaps(times))
    if unit <= 0:
        return beats, 0

    out = [times[0]]
    fixed = 0
    for i in range(len(times) - 1):
        a, b = times[i], times[i + 1]
        gap = b - a
        # 잣대의 몇 곱절인가. 반올림해 0이면 너무 좁아 덜어 낼 박이다.
        k = round(gap / unit)
        if abs(gap - unit) <= unit * 0.2:
            out.append(b)
            continue
        fixed += 1
        if k <= 0:
            continue  # 이 박은 버린다 — 다음 박이 제자리를 잡는다
        for j in range(1, k + 1):
            out.append(a + gap * j / k)
    if not fixed:
        return beats, 0
    return _renumber(out, beats, per_bar), fixed


def scale(beats: list[dict], factor: float, per_bar: int = 4) -> list[dict]:
    """박을 절반(0.5)으로 덜거나 두 배(2)로 늘린다.

    0.5는 한 박씩 걸러 내어 마디가 두 배 길어지고, 2는 사이사이에 박을
    끼워 넣어 마디가 절반으로 짧아진다. 첫 박은 언제나 남는다.
    """
    times = [float(b["t"]) for b in beats]
    if len(times) < 4:
        return beats
    if factor < 1:
        times = times[::2]
    else:
        doubled = []
        for i in range(len(times) - 1):
            doubled.append(times[i])
            doubled.append((times[i] + times[i + 1]) / 2)
        doubled.append(times[-1])
        times = doubled
    return _renumber(times, beats, per_bar)


def bpm_of(beats: list[dict]) -> float:
    """고쳐 놓은 박에서 빠르기를 다시 잰다."""
    times = [float(b["t"]) for b in beats]
    if len(times) < 2:
        return 0.0
    unit = statistics.median(_gaps(times))
    return round(60 / unit, 2) if unit > 0 else 0.0
