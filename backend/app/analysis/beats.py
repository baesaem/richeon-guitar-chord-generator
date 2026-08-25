"""비트 · 다운비트 추적.

librosa의 비트 추적은 박(beat)만 준다. 마디 첫 박(다운비트)은 따로 추정해야 하는데,
코드가 보통 마디 경계에서 바뀐다는 점을 이용한다 — 크로마가 가장 크게 변하는 위상을 고른다.
M4에서 beat_this 같은 전용 모델로 교체할 자리.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .features import HOP_LENGTH, AudioBuffer, normalize_columns

BEAT_MODEL = "librosa-onset+phase"


@dataclass
class BeatGrid:
    bpm: float
    times: np.ndarray        # 각 비트의 시각(초)
    frames: np.ndarray       # 각 비트의 프레임 인덱스
    downbeat_phase: int      # times[i]가 다운비트면 i % beats_per_bar == downbeat_phase
    beats_per_bar: int = 4

    def positions(self) -> list[tuple[int, int]]:
        """각 비트의 (마디 번호, 마디 내 박 번호). 둘 다 1부터."""
        out: list[tuple[int, int]] = []
        for i in range(len(self.times)):
            offset = (i - self.downbeat_phase) % self.beats_per_bar
            bar = (i - self.downbeat_phase) // self.beats_per_bar + 1
            out.append((max(bar, 1), offset + 1))
        return out


def track_beats(audio: AudioBuffer, onset_env: np.ndarray) -> BeatGrid:
    import librosa

    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=audio.sr, hop_length=HOP_LENGTH, trim=False
    )
    beat_frames = np.asarray(beat_frames, dtype=int)
    times = librosa.frames_to_time(beat_frames, sr=audio.sr, hop_length=HOP_LENGTH)
    bpm = float(np.atleast_1d(tempo)[0])
    return BeatGrid(bpm=bpm, times=times, frames=beat_frames, downbeat_phase=0)


def estimate_downbeat_phase(
    beat_chroma: np.ndarray, onset_env: np.ndarray, beat_frames: np.ndarray,
    beats_per_bar: int = 4,
) -> int:
    """마디 첫 박의 위상(0~3)을 고른다.

    두 가지 근거를 합친다.
      - 화성 변화량: 직전 비트 대비 크로마가 크게 바뀌는 지점이 마디 머리일 가능성이 높다
      - 온셋 세기: 마디 첫 박이 대체로 더 세게 연주된다
    """
    n = beat_chroma.shape[1]
    if n < beats_per_bar * 2:
        return 0

    normed = normalize_columns(beat_chroma)
    novelty = np.zeros(n)
    novelty[1:] = 1.0 - np.sum(normed[:, 1:] * normed[:, :-1], axis=0)

    accent = np.zeros(n)
    for i, frame in enumerate(beat_frames[:n]):
        lo = max(int(frame) - 1, 0)
        hi = min(int(frame) + 2, len(onset_env))
        if hi > lo:
            accent[i] = float(np.max(onset_env[lo:hi]))

    novelty = _zscore(novelty)
    accent = _zscore(accent)
    score = novelty + 0.5 * accent

    phases = [
        float(np.mean(score[phase::beats_per_bar])) for phase in range(beats_per_bar)
    ]
    return int(np.argmax(phases))


def _zscore(x: np.ndarray) -> np.ndarray:
    std = float(np.std(x))
    return (x - float(np.mean(x))) / std if std > 1e-9 else np.zeros_like(x)
