"""BTC(Bi-directional Transformer for Chord recognition) 래퍼 — Plan B 코드 인식.

템플릿 방식(chords.py)을 대체한다. 어휘가 14종 × 12근음 = 168 + N/X로,
maj/min만 내던 베이스라인과 달리 7th·sus·dim까지 구분한다.

입력 사양(원 논문 학습 조건과 동일해야 한다):
  22050Hz 모노 → CQT(144빈, 옥타브당 24, hop 2048) → log → (x-mean)/std
mean/std는 체크포인트에 함께 저장돼 있다.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .chords import ChordSegment

BTC_MODEL_NAME = "btc-large-voca"

_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_QUALITIES = [
    "min", "maj", "dim", "aug", "min6", "maj6", "min7",
    "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4",
]

# BTC 어휘 → 우리 스키마 quality. hdim7(half-diminished)는 m7b5와 같은 코드다.
_QUALITY_MAP = {
    "min": "min", "maj": "maj", "dim": "dim", "aug": "aug",
    "min6": "min6", "maj6": "6", "min7": "min7", "minmaj7": "minmaj7",
    "maj7": "maj7", "7": "7", "dim7": "dim7", "hdim7": "min7b5",
    "sus2": "sus2", "sus4": "sus4",
}

# 화면 표기. 근음 뒤에 붙는 접미사.
_LABEL_SUFFIX = {
    "maj": "", "min": "m", "dim": "dim", "aug": "aug",
    "6": "6", "min6": "m6", "min7": "m7", "minmaj7": "mM7",
    "maj7": "maj7", "7": "7", "dim7": "dim7", "min7b5": "m7b5",
    "sus2": "sus2", "sus4": "sus4",
}

# CQT 파라미터 (run_config.yaml과 동일)
_SR = 22050
_N_BINS = 144
_BINS_PER_OCTAVE = 24
_HOP = 2048
_TIMESTEP = 108

_model_cache: tuple | None = None


def _checkpoint_path() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "btc_model_large_voca.pt"


def _load_model(device: str):
    """모델과 정규화 상수를 로드한다. 프로세스당 한 번."""
    global _model_cache
    if _model_cache is not None:
        return _model_cache

    import torch

    from .btc.btc_model import BTC_model

    config = {
        "feature_size": 144,
        "timestep": _TIMESTEP,
        "num_chords": 170,
        "input_dropout": 0.2,
        "layer_dropout": 0.2,
        "attention_dropout": 0.2,
        "relu_dropout": 0.2,
        "num_layers": 8,
        "num_heads": 4,
        "hidden_size": 128,
        "total_key_depth": 128,
        "total_value_depth": 128,
        "filter_size": 128,
        "loss": "ce",
        "probs_out": False,
    }

    model = BTC_model(config=config).to(device)
    checkpoint = torch.load(_checkpoint_path(), map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    _model_cache = (model, float(checkpoint["mean"]), float(checkpoint["std"]), device)
    return _model_cache


def _label_of(index: int) -> tuple[str | None, str]:
    """모델 출력 인덱스 → (근음, 우리 스키마 quality). N/X는 (None, 'N')."""
    if index >= 168:
        return None, "N"
    root = _ROOTS[index // 14]
    quality = _QUALITY_MAP[_QUALITIES[index % 14]]
    return root, quality


def format_label(root: str | None, quality: str) -> str:
    if root is None or quality == "N":
        return "N.C."
    return f"{root}{_LABEL_SUFFIX.get(quality, quality)}"


def recognize(wav_path: Path, duration: float, device: str) -> list[ChordSegment]:
    """오디오 파일 → 코드 구간 목록. 프레임 단위 예측을 구간으로 병합한다."""
    import librosa
    import torch

    model, mean, std, dev = _load_model(device)

    y, _ = librosa.load(str(wav_path), sr=_SR, mono=True)
    cqt = librosa.cqt(
        y, sr=_SR, n_bins=_N_BINS, bins_per_octave=_BINS_PER_OCTAVE, hop_length=_HOP
    )
    feature = np.log(np.abs(cqt) + 1e-6).T  # (T, 144)
    feature = (feature - mean) / std

    seconds_per_frame = _HOP / _SR

    # timestep 배수로 패딩
    pad = _TIMESTEP - (feature.shape[0] % _TIMESTEP)
    feature = np.pad(feature, ((0, pad), (0, 0)), mode="constant")
    n_chunks = feature.shape[0] // _TIMESTEP

    frames: list[int] = []
    tensor = torch.tensor(feature, dtype=torch.float32).unsqueeze(0).to(dev)
    with torch.no_grad():
        for t in range(n_chunks):
            chunk = tensor[:, _TIMESTEP * t : _TIMESTEP * (t + 1), :]
            attn, _ = model.self_attn_layers(chunk)
            prediction, _ = model.output_layer(attn)
            frames.extend(int(v) for v in prediction.squeeze().tolist())

    # 프레임 라벨 → 시간 구간
    segments: list[ChordSegment] = []
    start = 0.0
    current = frames[0] if frames else 169
    for i in range(1, len(frames)):
        if frames[i] != current:
            end = i * seconds_per_frame
            _append(segments, current, start, min(end, duration))
            start = end
            current = frames[i]
    _append(segments, current, start, duration)

    return [s for s in segments if s.end > s.start]


def _append(segments: list[ChordSegment], index: int, start: float, end: float) -> None:
    root, quality = _label_of(index)
    segments.append(
        ChordSegment(
            start=round(start, 3),
            end=round(end, 3),
            label=format_label(root, quality),
            root=root,
            quality=quality,
            # BTC는 확률을 따로 내주지 않는다. 프레임 예측이 이긴 클래스라는 사실만 안다.
            confidence=0.9,
        )
    )


def snap_to_beats(
    segments: list[ChordSegment], beat_times: np.ndarray, duration: float
) -> list[ChordSegment]:
    """구간 경계를 가장 가까운 비트로 스냅한다.

    프레임 단위(0.093초) 예측이라 경계가 비트에서 조금씩 어긋나고
    한 프레임짜리 파편도 생긴다. 코드는 박자 위에서 바뀐다는 사전지식으로
    경계를 비트에 붙이고, 스냅 후 길이가 0이 된 구간은 버린다.
    """
    if len(beat_times) < 2 or not segments:
        return segments

    grid = np.asarray(beat_times, dtype=float)

    def snap(t: float) -> float:
        i = int(np.argmin(np.abs(grid - t)))
        return float(grid[i])

    snapped: list[ChordSegment] = []
    for seg in segments:
        start = 0.0 if seg.start < grid[0] else snap(seg.start)
        end = duration if seg.end > grid[-1] else snap(seg.end)
        if end - start < 1e-3:
            continue
        # 같은 코드가 이어지면 앞 구간을 늘린다
        prev = snapped[-1] if snapped else None
        if prev and prev.label == seg.label and abs(prev.end - start) < 1e-3:
            prev.end = end
            continue
        snapped.append(
            ChordSegment(
                start=start, end=end, label=seg.label,
                root=seg.root, quality=seg.quality, confidence=seg.confidence,
            )
        )

    # 스냅 과정에서 구간 사이가 벌어졌으면 앞 구간을 늘려 메운다
    for i in range(1, len(snapped)):
        if snapped[i].start > snapped[i - 1].end:
            snapped[i - 1].end = snapped[i].start
    return snapped
