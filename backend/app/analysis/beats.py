"""비트 · 다운비트 추적.

기본은 beat_this(트랜스포머 비트 트래커). 비트와 다운비트를 함께 주므로
마디 위상을 휴리스틱으로 추정할 필요가 없다. GPU에서 3분 곡 1초 미만.

beat_this를 쓸 수 없으면(설치 안 됨, 체크포인트 다운로드 실패 등) librosa로
폴백한다. librosa는 박만 주므로 다운비트 위상은 크로마 변화량으로 추정한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .features import HOP_LENGTH, AudioBuffer, normalize_columns

NEURAL_MODEL = "beat_this-final0"
FALLBACK_MODEL = "librosa-onset+phase"

# 템포 배속 오류(느린 곡을 두 배로 잡는 것)를 휴리스틱으로 보정하려 했으나 실패했다.
# "한 박 걸러 세기가 약하면 사이 박"이라는 기준은 4/4에서 1·3박이 2·4박보다
# 센 것이 정상이라 거의 모든 곡에서 발동한다. 실제로 113 BPM으로 맞게 잡힌 곡을
# 56 BPM으로 망가뜨렸다. beat_this 교체가 정공법이고, 그래도 남는 오류는
# 사용자가 직접 고치게 둔다.


@dataclass
class BeatGrid:
    bpm: float
    times: np.ndarray        # 각 비트의 시각(초)
    frames: np.ndarray       # 각 비트의 프레임 인덱스 (크로마 집계용)
    model: str
    beats_per_bar: int = 4
    # 각 비트의 (마디 번호, 마디 내 박 번호). 둘 다 1부터.
    _positions: list[tuple[int, int]] | None = field(default=None, repr=False)
    # 폴백 경로에서만 쓰는 위상 값. positions가 없을 때 위상으로 계산한다.
    downbeat_phase: int = 0

    def positions(self) -> list[tuple[int, int]]:
        if self._positions is not None:
            return self._positions
        out: list[tuple[int, int]] = []
        for i in range(len(self.times)):
            offset = (i - self.downbeat_phase) % self.beats_per_bar
            bar = (i - self.downbeat_phase) // self.beats_per_bar + 1
            out.append((max(bar, 1), offset + 1))
        return out


# 모델은 무겁고 재사용 가능하므로 프로세스당 한 번만 만든다
_file2beats = None


def _neural_tracker(device: str):
    global _file2beats
    if _file2beats is None:
        from beat_this.inference import File2Beats

        _file2beats = File2Beats(checkpoint_path="final0", device=device)
    return _file2beats


def track_beats_neural(wav_path: Path, sr: int, device: str) -> BeatGrid:
    """beat_this로 비트·다운비트를 함께 얻는다."""
    tracker = _neural_tracker(device)
    beats, downbeats = tracker(str(wav_path))
    beats = np.asarray(beats, dtype=float)
    downbeats = np.asarray(downbeats, dtype=float)

    if len(beats) < 4:
        raise RuntimeError(f"비트가 {len(beats)}개뿐입니다")

    bpm = 60.0 / float(np.median(np.diff(beats)))

    # 각 비트에 마디 번호와 박 번호를 붙인다.
    # 다운비트 시각은 비트 목록의 원소와 같은 값이므로 근접 매칭으로 정렬한다.
    positions: list[tuple[int, int]] = []
    bar = 0
    beat_in_bar = 0
    down_idx = 0
    for t in beats:
        if down_idx < len(downbeats) and abs(t - downbeats[down_idx]) < 0.05:
            bar += 1
            beat_in_bar = 1
            down_idx += 1
        elif bar == 0:
            # 첫 다운비트 이전의 못갖춘마디(pickup)는 0번 마디로 둔다
            bar = 0
            beat_in_bar += 1
        else:
            beat_in_bar += 1
        positions.append((max(bar, 1), beat_in_bar))

    frames = np.round(beats * sr / HOP_LENGTH).astype(int)
    return BeatGrid(
        bpm=bpm,
        times=beats,
        frames=frames,
        model=NEURAL_MODEL,
        _positions=positions,
    )


def track_beats(audio: AudioBuffer, onset_env: np.ndarray) -> BeatGrid:
    """librosa 폴백. 박만 주므로 다운비트 위상은 따로 추정해야 한다."""
    import librosa

    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=audio.sr, hop_length=HOP_LENGTH, trim=False
    )
    beat_frames = np.asarray(beat_frames, dtype=int)
    times = librosa.frames_to_time(beat_frames, sr=audio.sr, hop_length=HOP_LENGTH)
    bpm = float(np.atleast_1d(tempo)[0])
    return BeatGrid(
        bpm=bpm, times=times, frames=beat_frames, model=FALLBACK_MODEL
    )


def _beat_accents(onset_env: np.ndarray, beat_frames: np.ndarray) -> np.ndarray:
    """각 박 위치의 온셋 세기. 프레임이 한 칸 어긋나도 잡히게 앞뒤를 함께 본다."""
    accent = np.zeros(len(beat_frames))
    for i, frame in enumerate(beat_frames):
        lo = max(int(frame) - 1, 0)
        hi = min(int(frame) + 2, len(onset_env))
        if hi > lo:
            accent[i] = float(np.max(onset_env[lo:hi]))
    return accent


def estimate_downbeat_phase(
    beat_chroma: np.ndarray, onset_env: np.ndarray, beat_frames: np.ndarray,
    beats_per_bar: int = 4,
) -> int:
    """(폴백 전용) 마디 첫 박의 위상(0~3)을 고른다.

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

    accent = _beat_accents(onset_env, beat_frames[:n])

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
