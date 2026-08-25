"""조성 추정 — Krumhansl-Schmuckler 프로파일 상관.

곡 전체 크로마 평균을 24개(장 12 + 단 12) 프로파일과 상관시켜 가장 잘 맞는 조를 고른다.
코드 인식 결과를 보정하거나 카포 위치를 추천할 때 쓴다.
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
