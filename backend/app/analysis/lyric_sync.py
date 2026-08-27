"""가사 시각을 실제 노래에 맞춘다.

가사 시각은 곡마다 조금씩 어긋난다. 가사 서비스의 동기화 가사도 어느
판(라이브·리메이크)에 맞춰 찍혔느냐에 따라 밀린다.

이건 사람이 손으로 맞출 일이 아니다. 보컬 트랙이 이미 있으니 어디서
노래가 시작하는지 알 수 있고, 가사 줄을 통째로 밀어 가장 잘 겹치는
자리를 찾으면 된다.

**문구가 시작하는 자리만 본다.** 소리가 나기 시작하는 지점을 모두
세면 4분 곡에 130개가 넘어 어디에 갖다 놓아도 얼추 맞는다 — 실측에서
엉뚱한 값(+0.95초)을 골랐다. 앞이 0.6초 넘게 조용했던 자리만 남기면
40개 안팎이 되고, 이것이 실제로 사람이 노래를 시작하는 자리다.

실측:
  혜화동(LRCLIB 동기화 가사) 25줄 — 보정 없이 6줄만 맞음,
    +0.40초로 17줄. 가사가 0.4초 일찍 찍혀 있었다.
  우리 사랑 기억하겠네(자막) 53줄 — 보정 없이 31줄,
    최적 +0.20초로 32줄. 차이가 없어 건드리지 않는다.
"""

from __future__ import annotations

from pathlib import Path

# 보컬이 울리기 시작했다고 볼 문턱. 조용한 구간의 잡음에 반응하지 않을 만큼
_ACTIVE_RATIO = 0.5
# 앞이 이만큼 조용했던 자리만 "문구 시작"으로 센다. 숨 쉬는 사이를 넘고
# 소절이 바뀌는 자리만 남기는 길이다.
_QUIET_BEFORE = 0.6
# 가사 줄이 보컬 시작점과 이만큼 안에 있으면 "맞았다"고 센다
_HIT_WINDOW = 0.35
# 찾아볼 보정 범위(초). 자막이 2초 넘게 어긋나는 일은 없다
_SEARCH = 2.0
_STEP = 0.05


def vocal_onsets(vocals_path: Path, quiet_before: float = 0.0) -> list[float]:
    """보컬이 울리기 시작하는 시각들. 트랙이 없으면 빈 목록.

    quiet_before를 주면 그만큼 조용했던 자리만 센다. 크게 잡을수록
    숨 쉬는 사이가 빠지고 소절이 바뀌는 자리만 남는다.
    """
    if not vocals_path.exists():
        return []
    try:
        import librosa
        import numpy as np
    except ImportError:
        return []

    try:
        y, sr = librosa.load(str(vocals_path), sr=22050, mono=True)
    except Exception:
        return []
    if y.size == 0:
        return []

    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
    active = rms > np.percentile(rms, 70) * _ACTIVE_RATIO

    hop = float(times[1] - times[0]) if len(times) > 1 else 0.023
    need = max(int((quiet_before or _QUIET_BEFORE) / hop), 1)
    starts = [
        float(times[i])
        for i in range(need, len(active))
        if active[i] and not active[i - 1] and not active[i - need : i].any()
    ]
    return starts


def phrase_starts(vocals_path: Path, want: int = 0) -> list[float]:
    """노래가 시작하는 자리들. want를 주면 그 개수에 가깝게 골라 준다.

    조용했던 시간을 얼마로 잡느냐에 따라 자리 수가 크게 달라진다 —
    0.6초로 잡으면 숨 쉬는 사이까지 잡혀 41개, 1.5초로 잡으면 소절이
    바뀌는 자리만 남는다.

    붙여넣은 가사를 놓을 때는 **줄 수와 자리 수가 비슷해야** 어긋나지
    않는다. 자리가 두 배면 한 줄 건너 하나씩 골라야 하는데, 숨 쉬는
    간격이 고르지 않아 뒤로 갈수록 밀린다. 그래서 줄 수에 가장 가까운
    문턱을 찾아 쓴다.
    """
    if want <= 0:
        return vocal_onsets(vocals_path)

    best: list[float] = []
    best_gap = None
    for quiet in (0.5, 0.7, 0.9, 1.2, 1.6, 2.0, 2.5, 3.0):
        starts = vocal_onsets(vocals_path, quiet)
        if not starts:
            continue
        gap = abs(len(starts) - want)
        if best_gap is None or gap < best_gap:
            best, best_gap = starts, gap
        if gap == 0:
            break
    return best


def best_offset(line_times: list[float], onsets: list[float]) -> tuple[float, int, int]:
    """가사를 통째로 밀어 보며 가장 잘 겹치는 보정을 찾는다.

    (보정초, 맞은 줄 수, 보정 없을 때 맞은 줄 수)를 돌려준다.
    """
    if len(line_times) < 4 or len(onsets) < 4:
        return 0.0, 0, 0

    import numpy as np

    starts = np.asarray(line_times, dtype=float)
    marks = np.asarray(onsets, dtype=float)

    def hits(offset: float) -> int:
        gaps = np.abs((starts + offset)[:, None] - marks[None, :]).min(axis=1)
        return int((gaps < _HIT_WINDOW).sum())

    base = hits(0.0)
    best, best_hits = 0.0, base
    for step in np.arange(-_SEARCH, _SEARCH + 1e-9, _STEP):
        got = hits(float(step))
        if got > best_hits:
            best, best_hits = float(step), got
    return round(best, 2), best_hits, base


# 줄 하나를 옮길 수 있는 최대 거리. 이보다 멀면 그 줄에 맞는 문구
# 시작점이 없다고 보고 그대로 둔다.
_SNAP = 0.6


def snap(line_times: list[float], vocals_path: Path) -> tuple[list[float], int]:
    """가사 줄을 가까운 문구 시작점에 붙인다. (새 시각, 옮긴 줄 수)

    **곡 전체를 통째로 미는 방식은 쓰지 않는다.** 실측에서 이미 잘 맞는
    자막(우리 사랑 기억하겠네)을 1.15초나 밀어 버렸다. 겹치는 줄 수를
    최대로 만드는 값이 늘 옳은 것은 아니다 — 문구 시작점이 40개쯤 되면
    엉뚱한 자리에서도 얼추 맞는다.

    대신 줄마다 가장 가까운 문구 시작점을 찾아, 0.6초 안이면 거기에
    붙인다. 옮기는 거리가 제한돼 있어 잘 맞는 가사를 망가뜨리지 않고,
    조금씩 밀린 가사는 제자리를 찾는다.

    줄 순서는 지킨다 — 붙이다가 앞뒤가 뒤집히면 가사가 뒤죽박죽이 된다.
    """
    onsets = vocal_onsets(vocals_path)
    if len(onsets) < 4 or len(line_times) < 2:
        return list(line_times), 0

    out: list[float] = []
    moved = 0
    for i, t in enumerate(line_times):
        near = min(onsets, key=lambda o: abs(o - t))
        target = near if abs(near - t) <= _SNAP else t
        # 앞 줄보다 뒤에 와야 한다
        floor = out[-1] + 0.05 if out else 0.0
        # 다음 줄을 넘어서도 안 된다
        ceil = line_times[i + 1] - 0.05 if i + 1 < len(line_times) else float("inf")
        fixed = min(max(target, floor), max(ceil, floor))
        if abs(fixed - t) > 0.02:
            moved += 1
        out.append(round(fixed, 2))
    return out, moved
