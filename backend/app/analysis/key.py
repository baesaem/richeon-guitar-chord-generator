"""조성 추정.

두 가지 방법을 쓴다.

1. 코드 진행으로 정하기(estimate_key_from_chords) — 기본.
   화성이 이미 뽑혀 있으면 그것이 조성의 가장 좋은 증거다. G-C-D가 주로
   나오면 G장조다. 소리의 세기가 아니라 "무엇을 짚었는가"를 보므로,
   베이스가 5도를 많이 울리거나 특정 악기가 도드라져도 흔들리지 않는다.

2. 크로마 프로파일 상관(estimate_key) — 코드가 없을 때의 폴백.
   Krumhansl-Schmuckler 방식. 곡 전체 음 분포를 24개 조 프로파일과
   견준다. 간편하지만 딸림음이 강한 곡에서 5도 위 조로 밀리는 약점이 있다.
"""

from __future__ import annotations

import numpy as np

from .features import PITCH_NAMES

MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


def estimate_key(chroma: np.ndarray) -> tuple[str, float]:
    """(예: "G major", 상관계수) 를 돌려준다."""
    profile = chroma.mean(axis=1)
    if float(np.std(profile)) < 1e-9:
        return "", 0.0

    best_score = -2.0
    best_name = ""
    for root in range(12):
        rotated = np.roll(profile, -root)
        for template, mode in ((MAJOR_PROFILE, "major"), (MINOR_PROFILE, "minor")):
            score = float(np.corrcoef(rotated, template)[0, 1])
            if score > best_score:
                best_score = score
                best_name = f"{PITCH_NAMES[root]} {mode}"
    return best_name, best_score


# 조성 안에서 각 자리 화음이 얼마나 자주·중요하게 쓰이는지.
# I·IV·V가 곡을 떠받치고, vi·ii·iii가 그 사이를 채운다. vii°는 드물다.
_MAJOR_DEGREES = {0: 3.0, 2: 1.2, 4: 1.0, 5: 2.5, 7: 2.8, 9: 1.6, 11: 0.4}
_MINOR_DEGREES = {0: 3.0, 2: 0.6, 3: 2.0, 5: 1.6, 7: 2.4, 8: 2.0, 10: 1.8}

# 3화음의 성격이 조성의 자리와 맞는지. 맞으면 그 조성의 증거가 된다.
_MAJOR_QUALITY_AT = {0: "maj", 2: "min", 4: "min", 5: "maj", 7: "maj", 9: "min", 11: "dim"}
_MINOR_QUALITY_AT = {0: "min", 2: "dim", 3: "maj", 5: "min", 7: "min", 8: "maj", 10: "maj"}

_PITCH_CLASS = {name: i for i, name in enumerate(PITCH_NAMES)}

# 화음 종류를 장·단·감 셋으로 뭉뚱그린다. 7th·sus 따위는 바탕 3화음으로 본다.
_TRIAD = {
    "maj": "maj", "maj7": "maj", "7": "maj", "6": "maj", "aug": "maj",
    "sus2": "maj", "sus4": "maj", "add9": "maj",
    "min": "min", "min7": "min", "min6": "min", "minmaj7": "min",
    "dim": "dim", "dim7": "dim", "min7b5": "dim",
}


def estimate_key_from_chords(chords) -> tuple[str, float]:
    """코드 진행에서 조성을 고른다. (예: "G major", 0~1 점수)

    24개 조를 모두 놓고, 각 코드가 그 조에서 얼마나 자연스러운지 길이로
    가중해 더한다. 조성 밖 코드는 감점한다. 가장 높은 점수를 받은 조가
    답이다.
    """
    weighted: list[tuple[int, str, float]] = []
    for chord in chords:
        root = getattr(chord, "root", None)
        quality = getattr(chord, "quality", "maj")
        if not root or quality == "N" or root not in _PITCH_CLASS:
            continue
        length = float(getattr(chord, "end", 0.0) - getattr(chord, "start", 0.0))
        if length <= 0:
            continue
        weighted.append((_PITCH_CLASS[root], _TRIAD.get(quality, "maj"), length))

    if not weighted:
        return "", 0.0

    total = sum(w for _, _, w in weighted)
    best_name, best_score = "", -1e9
    for tonic in range(12):
        for degrees, quality_at, mode in (
            (_MAJOR_DEGREES, _MAJOR_QUALITY_AT, "major"),
            (_MINOR_DEGREES, _MINOR_QUALITY_AT, "minor"),
        ):
            score = 0.0
            for pc, triad, weight in weighted:
                step = (pc - tonic) % 12
                importance = degrees.get(step)
                if importance is None:
                    score -= weight * 1.2   # 조성 밖 근음
                    continue
                score += weight * importance
                # 자리에 맞는 성격이면 확신을 더한다. 장단이 뒤집힌 조를
                # 고르는 실수를 막는 결정적 단서다.
                if _TRIAD.get(quality_at[step], quality_at[step]) == triad:
                    score += weight * 1.5
                else:
                    score -= weight * 0.8
            if score > best_score:
                best_score, best_name = score, f"{PITCH_NAMES[tonic]} {mode}"

    # 0~1로 눌러 둔다. 만점(모든 코드가 I이고 성격까지 맞음)은 4.5배.
    return best_name, round(min(max(best_score / (total * 4.5), 0.0), 1.0), 3)
