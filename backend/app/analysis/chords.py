"""코드 인식 — Plan A 베이스라인.

비트별 크로마를 24개 코드 템플릿(장3화음 12 + 단3화음 12) 및 무음(N)과 비교하고,
Viterbi로 시간 방향 스무딩을 건다. 코드가 매 비트 바뀌지 않는다는 사전지식을
전이확률(자기 자신으로 남을 확률이 높음)로 넣는 것이 정확도의 핵심이다.

기대 정확도는 maj/min 어휘 기준 55~65% 수준. M4에서 사전학습 모델로 교체한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .features import PITCH_NAMES, normalize_columns

CHORD_MODEL = "template24+viterbi"

# 코드가 이어질 확률. 높일수록 결과가 뭉툭해지고 낮추면 잘게 흔들린다.
SELF_TRANSITION = 0.85
# 무음/타악기만 있는 구간을 N(코드 없음)으로 보낼 에너지 문턱
SILENCE_THRESHOLD = 0.02
# 크로마 로그 압축 계수. 클수록 약한 배음까지 살아나 화성 윤곽이 또렷해진다.
LOG_COMPRESSION = 10.0
# 소리가 있는 구간에서 N이 가져가는 기본 점수. 어떤 코드와도 안 맞을 때만 이긴다.
N_FLOOR = 0.03


@dataclass
class ChordSegment:
    start: float
    end: float
    label: str
    root: str | None
    quality: str
    confidence: float


def _center(mat: np.ndarray) -> np.ndarray:
    """열마다 평균을 빼고 정규화 → 코사인이 곧 상관계수가 된다.

    평균을 빼지 않으면 모든 크로마가 '전체적으로 양수'라는 공통 성분 때문에
    어떤 템플릿과도 높은 유사도를 갖는다. 특히 균일 벡터(N)가 항상 이겨버린다.
    """
    return normalize_columns(mat - mat.mean(axis=0, keepdims=True))


def _templates() -> tuple[np.ndarray, list[tuple[str, str]]]:
    """(12, 24) 템플릿 행렬과 각 열의 (근음, 종류). N은 따로 처리한다."""
    maj = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    minor = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=float)

    cols: list[np.ndarray] = []
    labels: list[tuple[str, str]] = []
    for shape, quality in ((maj, "maj"), (minor, "min")):
        for root in range(12):
            cols.append(np.roll(shape, root))
            labels.append((PITCH_NAMES[root], quality))

    return _center(np.stack(cols, axis=1)), labels


def _transition_matrix(n_states: int) -> np.ndarray:
    off = (1.0 - SELF_TRANSITION) / (n_states - 1)
    trans = np.full((n_states, n_states), off)
    np.fill_diagonal(trans, SELF_TRANSITION)
    return trans


def recognize(beat_chroma: np.ndarray, beat_times: np.ndarray, duration: float) -> list[ChordSegment]:
    import librosa

    templates, chord_labels = _templates()
    labels: list[tuple[str | None, str]] = [*chord_labels, (None, "N")]
    n_states = templates.shape[1] + 1  # 24개 코드 + N
    n_beats = beat_chroma.shape[1]
    if n_beats == 0:
        return []

    energy = np.linalg.norm(beat_chroma, axis=0)
    compressed = np.log1p(LOG_COMPRESSION * np.maximum(beat_chroma, 0.0))

    # 상관계수 기반 유사도. 음수(= 해당 코드와 반대 방향)는 0으로 잘라낸다.
    similarity = np.clip(templates.T @ _center(compressed), 0.0, None) ** 2

    score = np.vstack([similarity, np.full((1, n_beats), N_FLOOR)])

    # 에너지가 거의 없는 비트는 코드가 아니라 N으로 보낸다.
    quiet = energy < SILENCE_THRESHOLD * max(float(np.max(energy)), 1e-9)
    score[:-1, quiet] = 0.0
    score[-1, quiet] = 1.0

    prob = score / np.maximum(score.sum(axis=0, keepdims=True), 1e-9)
    path = librosa.sequence.viterbi(prob, _transition_matrix(n_states))

    return _to_segments(path, prob, labels, beat_times, duration)


def _to_segments(
    path: np.ndarray,
    prob: np.ndarray,
    labels: list[tuple[str | None, str]],
    beat_times: np.ndarray,
    duration: float,
) -> list[ChordSegment]:
    """같은 코드가 이어지는 비트를 하나의 구간으로 합친다."""
    segments: list[ChordSegment] = []
    n = len(path)
    i = 0
    while i < n:
        state = int(path[i])
        j = i
        while j + 1 < n and int(path[j + 1]) == state:
            j += 1

        root, quality = labels[state]
        start = float(beat_times[i])
        end = float(beat_times[j + 1]) if j + 1 < len(beat_times) else duration
        confidence = float(np.mean(prob[state, i : j + 1]))

        segments.append(
            ChordSegment(
                start=start,
                end=max(end, start + 1e-3),
                label=_format_label(root, quality),
                root=root,
                quality=quality,
                confidence=confidence,
            )
        )
        i = j + 1
    return segments


def _format_label(root: str | None, quality: str) -> str:
    if root is None or quality == "N":
        return "N.C."
    return f"{root}m" if quality == "min" else root


def merge_same_label(segments: list[ChordSegment]) -> list[ChordSegment]:
    """맞닿은 같은 코드를 하나로 잇는다.

    스냅·흡수를 거치면 같은 코드가 여러 토막으로 남는다. 악보에서는
    한 코드가 이어지는 것이므로 토막마다 코드명을 다시 적을 이유가 없다.
    """
    out: list[ChordSegment] = []
    for seg in segments:
        prev = out[-1] if out else None
        if prev and prev.label == seg.label:
            prev.end = seg.end
            prev.confidence = max(prev.confidence, seg.confidence)
            continue
        out.append(seg)
    return out


def drop_sandwiched(
    segments: list[ChordSegment], max_duration: float
) -> list[ChordSegment]:
    """앞뒤가 같은 코드인 짧은 구간을 지운다.

    G - (반박짜리 Em7) - G 처럼 한 코드가 이어지는 중에 다른 코드가
    잠깐 끼는 것은 대개 오인식이다. 특히 마디가 바뀌는 지점에서 베이스가
    움직이거나 타악기가 들어오면 잘 생긴다. 양옆이 같은 코드라는 사실이
    "여긴 원래 한 코드였다"는 강한 증거다.
    """
    if len(segments) < 3:
        return segments

    out = [segments[0]]
    for i in range(1, len(segments) - 1):
        seg = segments[i]
        nxt = segments[i + 1]
        short = seg.end - seg.start < max_duration
        if short and out[-1].label == nxt.label:
            out[-1].end = seg.end   # 앞 코드가 그 자리를 이어받는다
            continue
        out.append(seg)
    out.append(segments[-1])
    return merge_same_label(out)


def absorb_gaps(
    segments: list[ChordSegment], max_duration: float
) -> list[ChordSegment]:
    """곡 중간의 짧은 무음(N.C.)을 앞 코드로 흡수한다.

    소리가 잠깐 잦아들면 N.C.가 뜨는데, 연주자 입장에서는 앞 코드를
    그대로 짚고 있는 구간이다. 곡의 처음과 끝(도입·아웃트로)은 실제로
    코드가 없으므로 건드리지 않는다.
    """
    if len(segments) < 3:
        return segments

    out = [segments[0]]
    for i in range(1, len(segments) - 1):
        seg = segments[i]
        if seg.quality == "N" and seg.end - seg.start < max_duration:
            out[-1].end = seg.end
            continue
        out.append(seg)
    out.append(segments[-1])
    return merge_same_label(out)


def fix_sounding_gaps(
    segments: list[ChordSegment],
    peaks: list[float],
    peaks_per_second: int,
    *,
    ratio: float = 0.35,
) -> list[ChordSegment]:
    """소리가 나고 있는데 N.C.로 찍힌 구간을 이웃 코드로 되돌린다.

    모델은 화성이 흐릿하면(간주에서 한 악기만 남거나, 코드 전환이 모호하면)
    무음이 아닌데도 N.C.를 낸다. 연주가 이어지는 자리에 N.C.가 뜨면 연주자는
    무엇을 짚어야 할지 알 수 없다.

    판단 근거는 파형 세기다. 그 구간의 평균 세기가 곡 전체 평균의 ratio를
    넘으면 "연주 중"으로 보고 앞(없으면 뒤) 코드로 채운다. 진짜 도입·간주의
    정적은 세기가 낮아 그대로 남는다.
    """
    if not peaks or peaks_per_second <= 0 or len(segments) < 2:
        return segments

    voiced = [p for p in peaks if p > 0.02]
    if not voiced:
        return segments
    threshold = (sum(voiced) / len(voiced)) * ratio

    def loudness(start: float, end: float) -> float:
        lo = max(0, int(start * peaks_per_second))
        hi = min(len(peaks), max(lo + 1, int(end * peaks_per_second)))
        window = peaks[lo:hi]
        return sum(window) / len(window) if window else 0.0

    out = list(segments)
    for i, seg in enumerate(out):
        if seg.quality != "N":
            continue
        if loudness(seg.start, seg.end) < threshold:
            continue  # 실제로 조용한 구간이면 N.C.가 맞다

        # 앞 코드를 잇는 것이 자연스럽다. 첫 구간이면 뒤 코드를 당겨 온다.
        donor = None
        for j in range(i - 1, -1, -1):
            if out[j].quality != "N":
                donor = out[j]
                break
        if donor is None:
            for j in range(i + 1, len(out)):
                if out[j].quality != "N":
                    donor = out[j]
                    break
        if donor is None:
            continue

        seg.label = donor.label
        seg.root = donor.root
        seg.quality = donor.quality
        seg.confidence = min(seg.confidence, 0.5)  # 추정으로 채운 자리

    return merge_same_label(out)


def merge_short_segments(
    segments: list[ChordSegment], min_duration: float
) -> list[ChordSegment]:
    """너무 짧은 구간을 양옆 중 더 그럴듯한 쪽에 흡수시킨다.

    Viterbi가 대부분 걸러주지만, 코드 전환 지점에서 한 비트짜리 파편이 남는다.
    악보로 보면 읽기 어려운 잡음이라 여기서 정리한다.
    """
    if len(segments) < 2:
        return segments

    merged = list(segments)
    changed = True
    while changed and len(merged) > 1:
        changed = False
        for i, seg in enumerate(merged):
            if seg.end - seg.start >= min_duration:
                continue

            prev = merged[i - 1] if i > 0 else None
            nxt = merged[i + 1] if i + 1 < len(merged) else None
            if prev is None and nxt is None:
                continue

            # 더 긴 쪽(= 더 안정적인 코드)에 붙인다
            take_prev = prev is not None and (
                nxt is None or (prev.end - prev.start) >= (nxt.end - nxt.start)
            )
            if take_prev:
                prev.end = seg.end          # type: ignore[union-attr]
            else:
                nxt.start = seg.start       # type: ignore[union-attr]
            merged.pop(i)
            changed = True
            break

    return merge_same_label(merged)
