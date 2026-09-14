"""노래방 가사를 보컬에 맞추는 데 쓸 「부르는 자리」.

악보·받아쓰기로 놓은 가사 글자는 대개 맞지만, 악보와 음원이 어긋난 대목
(라이브에서 간주를 늘렸거나 한 마디씩 밀린 자리)에서는 간주 중에 가사가
흐른다(강사님: 「음원의 보컬을 참고해 가사를 표시, 지금 간주 중에도 가사가
나옴」). 보컬 트랙에서 두 가지를 잰다.

- segments: 소리 내어 부르는 구간(짧은 틈은 잇는다)
- onsets: 음마다의 시작 — 가사 글자는 대개 한 음에 한 글자다

한 번 재면 캐시한다(곡당 몇 초).
"""

from __future__ import annotations

import json

from .analysis.separate import vocals_path
from .config import settings


def _cache(result_id: str):
    return settings.audio_dir / f"{result_id}.vocalmap.json"


def vocal_map(result_id: str) -> dict | None:
    """{"onsets": [...초], "segments": [[시작, 끝], ...]}. 보컬 트랙이 없으면 None."""
    cache = _cache(result_id)
    if cache.exists():
        try:
            return json.loads(cache.read_text("utf-8"))
        except Exception:
            pass

    path = vocals_path(result_id)
    if not path.exists():
        return None

    import librosa
    import numpy as np

    sr, hop = 22050, 256
    y, _ = librosa.load(str(path), sr=sr, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]
    if not len(rms) or float(rms.max()) <= 0:
        return None
    t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    thr = float(rms.max()) * 0.10
    voiced = rms > thr

    # 부르는 구간 — 0.6초 안의 틈(숨)은 잇고, 0.3초보다 짧은 소리(잡음)는 버린다
    segs: list[list[float]] = []
    start: float | None = None
    for i, v in enumerate(voiced):
        if v and start is None:
            start = float(t[i])
        elif not v and start is not None:
            segs.append([start, float(t[i])])
            start = None
    if start is not None:
        segs.append([start, float(t[-1])])
    merged: list[list[float]] = []
    for a, b in segs:
        if merged and a - merged[-1][1] < 0.6:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    segments = [[round(a, 2), round(b, 2)] for a, b in merged if b - a > 0.3]

    # 음마다의 시작. 조용한 자리의 것(반주가 새어 든 것)은 버린다
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    frames = librosa.onset.onset_detect(
        onset_envelope=env, sr=sr, hop_length=hop, backtrack=True, units="frames"
    )
    last = len(rms) - 1
    onsets = [
        round(float(librosa.frames_to_time(f, sr=sr, hop_length=hop)), 2)
        for f in frames
        if rms[min(int(f) + 3, last)] > thr * 0.8
    ]

    out = {"onsets": onsets, "segments": segments}
    try:
        cache.write_text(json.dumps(out), "utf-8")
    except OSError:
        pass
    return out
