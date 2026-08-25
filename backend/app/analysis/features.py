"""오디오 로딩과 크로마 특징.

비트 단위로 집계한 크로마(beat-synchronous chroma)가 코드 인식의 입력이다.
프레임 단위로 바로 코드를 붙이면 잡음이 심해서, 박자에 맞춰 먼저 뭉친다.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

HOP_LENGTH = 512

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


@dataclass
class AudioBuffer:
    y: np.ndarray
    sr: int

    @property
    def duration(self) -> float:
        return len(self.y) / self.sr


def load_audio(path: Path) -> AudioBuffer:
    import librosa

    y, sr = librosa.load(str(path), sr=None, mono=True)
    return AudioBuffer(y=y, sr=int(sr))


def onset_envelope(audio: AudioBuffer) -> np.ndarray:
    import librosa

    return librosa.onset.onset_strength(
        y=audio.y, sr=audio.sr, hop_length=HOP_LENGTH
    )


def chroma(audio: AudioBuffer, *, hpss: bool = True) -> np.ndarray:
    """CQT 기반 크로마. (12, n_frames)

    타악기 성분이 크로마를 흐리므로 기본적으로 하모닉 성분만 남긴 뒤 계산한다.
    Demucs로 이미 드럼을 걷어낸 트랙이면 `hpss=False`로 이 단계를 건너뛴다
    (3분 곡 기준 8초 이상 절약되고, 두 번 걸러 화성이 뭉개지는 것도 막는다).
    """
    import librosa

    y = librosa.effects.harmonic(audio.y, margin=3.0) if hpss else audio.y
    return librosa.feature.chroma_cqt(
        y=y, sr=audio.sr, hop_length=HOP_LENGTH, bins_per_octave=36
    )


def sync_to_beats(feature: np.ndarray, beat_frames: np.ndarray) -> np.ndarray:
    """프레임 단위 특징을 비트 구간별 중앙값으로 뭉친다.

    주의: 결과는 비트 개수보다 **1개 많다**. librosa가 첫 비트 이전 구간을
    0번 열로 넣어주기 때문이다. 시간축을 맞출 때는 `beat_boundaries()`를 쓸 것.
    """
    import librosa

    return librosa.util.sync(feature, beat_frames, aggregate=np.median)


def beat_boundaries(beat_times: np.ndarray) -> np.ndarray:
    """`sync_to_beats` 결과의 각 열이 시작되는 시각. 길이는 비트 수 + 1."""
    return np.concatenate([[0.0], np.asarray(beat_times, dtype=float)])


def normalize_columns(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=0, keepdims=True)
    return mat / np.maximum(norms, 1e-9)


def envelope(audio: AudioBuffer, per_second: int = 25) -> list[float]:
    """타임라인용 파형 포락선.

    구간별 최대 진폭을 0~1로 정규화해 돌려준다. 화면에 그리는 용도라
    정밀도가 필요 없어 소수 둘째 자리까지만 남겨 JSON 크기를 줄인다.
    """
    if len(audio.y) == 0:
        return []

    bucket = max(int(audio.sr / per_second), 1)
    n = len(audio.y) // bucket
    if n == 0:
        return []

    trimmed = np.abs(audio.y[: n * bucket]).reshape(n, bucket)
    peaks = trimmed.max(axis=1)
    peak_max = float(peaks.max())
    if peak_max <= 1e-9:
        return [0.0] * n
    return [round(float(v), 2) for v in peaks / peak_max]
