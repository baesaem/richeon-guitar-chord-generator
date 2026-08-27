"""스트로크(스트럼) 채보.

기타를 언제 쓸어내리고 쓸어올리는지 읽어 낸다.

원리는 간단하다. 코드가 무엇인지는 화성이 알려주지만, 어떻게 치는지는
**소리가 시작하는 순간**이 알려준다. 드럼을 걷어낸 트랙에서 그 순간을
모으고, 이미 잡아 둔 박 격자 위에 올려놓으면 리듬 패턴이 드러난다.

방향은 격자 자리로 정한다. 통기타 주법의 기본 원리다 — 손은 일정하게
위아래로 오가므로, 정박에는 손이 내려가는 중이고(다운) 엇박에는 올라오는
중이다(업). 실제로 치는 손을 보지 않고도 이 규칙이 대개 맞는다.

실측(할아버지와 수박): 온셋의 97.9%가 8분 격자에 붙고 평균 오차 25ms.
"""

from __future__ import annotations

import numpy as np

from ..schemas import Strum

# 격자를 몇 등분할지 정할 때 쓰는 문턱. 16분 자리에 이만큼은 쳐야
# 16분 곡으로 본다. 8비트 곡에서 스치듯 들어간 소리에 휘둘리지 않는다.
_SIXTEENTH_RATIO = 0.12

# 격자 한 칸의 이만큼 안에 들어와야 그 칸을 친 것으로 인정한다.
_SNAP_TOLERANCE = 0.35


def _subdivision(onsets: np.ndarray, grid16: np.ndarray) -> int:
    """이 곡이 8비트인지 16비트인지 고른다."""
    if len(grid16) < 4 or onsets.size == 0:
        return 2
    offbeat16 = 0
    for t in onsets:
        j = int(np.argmin(np.abs(grid16 - t)))
        if j % 2 == 1:      # 16분에서만 생기는 자리
            offbeat16 += 1
    return 4 if offbeat16 / len(onsets) >= _SIXTEENTH_RATIO else 2


def _build_grid(beats: np.ndarray, div: int) -> np.ndarray:
    """박 사이를 div등분한 격자. 마지막 박 뒤로도 한 칸 이어 둔다."""
    out: list[float] = []
    for i in range(len(beats) - 1):
        span = beats[i + 1] - beats[i]
        for k in range(div):
            out.append(float(beats[i] + span * k / div))
    if len(beats) >= 2:
        out.append(float(beats[-1]))
    return np.asarray(out)


def detect(
    wav_path, beats: np.ndarray, *, sample_rate: int = 22050
) -> list[Strum]:
    """드럼을 걷어낸 트랙 + 박 격자 → 스트로크 목록."""
    import librosa

    if len(beats) < 4:
        return []

    y, sr = librosa.load(str(wav_path), sr=sample_rate, mono=True)
    if y.size == 0:
        return []

    hop = 256
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop)
    if frames.size == 0:
        return []

    onsets = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    strength = env[frames]
    peak = float(strength.max()) or 1.0

    grid16 = _build_grid(beats, 4)
    div = _subdivision(onsets, grid16)
    grid = _build_grid(beats, div)
    if grid.size == 0:
        return []

    step = float(np.median(np.diff(grid))) if grid.size > 1 else 0.25
    tolerance = step * _SNAP_TOLERANCE

    # 한 칸에 여러 온셋이 몰리면 가장 센 것만 남긴다(울림·잔향 제거)
    best: dict[int, tuple[float, float]] = {}
    for t, s in zip(onsets, strength):
        j = int(np.argmin(np.abs(grid - t)))
        if abs(grid[j] - t) > tolerance:
            continue
        prev = best.get(j)
        if prev is None or s > prev[1]:
            best[j] = (float(grid[j]), float(s))

    return [
        Strum(
            t=round(when, 3),
            # 정박이면 손이 내려가는 중, 사이 자리면 올라오는 중이다
            down=(slot % div == 0),
            strength=round(min(max(power / peak, 0.0), 1.0), 3),
        )
        for slot, (when, power) in sorted(best.items())
    ]
