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


def chroma(audio: AudioBuffer) -> np.ndarray:
    """CQT 기반 크로마. (12, n_frames)

    타악기 성분이 크로마를 흐리므로 하모닉 성분만 남긴 뒤 계산한다.
    M4에서 Demucs 분리로 대체하면 이 단계는 빠질 수 있다.
    """
    import librosa

    y_harmonic = librosa.effects.harmonic(audio.y, margin=3.0)
    return librosa.feature.chroma_cqt(
        y=y_harmonic, sr=audio.sr, hop_length=HOP_LENGTH, bins_per_octave=36
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
