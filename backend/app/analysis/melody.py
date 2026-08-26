"""보컬 멜로디 채보.

분리해 둔 보컬 트랙에서 음높이를 따라 읽어 음표 목록을 만든다.

보컬은 한 번에 한 음만 내므로 단선율 추적기(pYIN)로 충분하다. 다성음악용
모델을 쓰면 반주가 섞여 들어와 오히려 지저분해진다.

노래는 음을 정확한 반음에 딱 맞춰 내지 않는다(비브라토·포르타멘토·살짝
올려 부르기). 그래서 프레임별 음높이를 그대로 음표로 옮기면 음이 잘게
갈라진다. 반음 단위로 반올림한 뒤 같은 음이 이어지는 구간을 하나로 묶고,
너무 짧은 것은 버린다.
"""

from __future__ import annotations

import numpy as np

from ..schemas import Note

# 사람 목소리가 실제로 내는 범위. 밖으로 나가면 반주가 새어든 것으로 본다.
FMIN_HZ = 82.0    # E2
FMAX_HZ = 1047.0  # C6

# 이보다 짧은 음은 채보하지 않는다. 32분음표보다 짧은 것은 흔들림이다.
MIN_NOTE_SEC = 0.09

# 이 정도로 목소리일 확률이 낮으면 무음으로 본다
VOICED_THRESHOLD = 0.4

# 음높이를 다듬는 창(프레임 수). 노래는 한 음 안에서도 음높이가 출렁이는데
# (비브라토·음을 끌어올리며 시작하기), 반올림 직전에 중앙값으로 눌러 주지
# 않으면 한 음이 60-61-60처럼 잘게 갈라진다.
SMOOTH_FRAMES = 9


def _to_midi(freq_hz: np.ndarray) -> np.ndarray:
    """주파수 → MIDI 번호(소수). 무음(nan)은 그대로 둔다."""
    with np.errstate(divide="ignore", invalid="ignore"):
        return 69.0 + 12.0 * np.log2(freq_hz / 440.0)


def _median_smooth(values: np.ndarray, mask: np.ndarray, width: int) -> np.ndarray:
    """마스크가 켜진 자리만 이동 중앙값으로 다듬는다.

    평균이 아니라 중앙값을 쓰는 이유: 음이 바뀌는 경계에서 평균은 두 음
    사이의 없는 음을 만들어 내지만, 중앙값은 어느 한쪽으로 붙는다.
    """
    out = values.copy()
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return out

    half = width // 2
    picked = values[idx]
    smoothed = np.empty_like(picked)
    for i in range(picked.size):
        lo = max(0, i - half)
        hi = min(picked.size, i + half + 1)
        smoothed[i] = np.median(picked[lo:hi])
    out[idx] = smoothed
    return out


def transcribe(
    vocals_path, duration: float, *, sample_rate: int = 22050
) -> list[Note]:
    """보컬 wav → 음표 목록."""
    import librosa

    y, sr = librosa.load(str(vocals_path), sr=sample_rate, mono=True)
    if y.size == 0:
        return []

    hop = 256  # 약 12ms. 짧은 음도 놓치지 않는 정도.
    f0, voiced, voiced_prob = librosa.pyin(
        y,
        fmin=FMIN_HZ,
        fmax=FMAX_HZ,
        sr=sr,
        hop_length=hop,
        fill_na=np.nan,
    )

    midi = _to_midi(f0)
    times = librosa.frames_to_time(np.arange(len(midi)), sr=sr, hop_length=hop)

    sung = voiced & (voiced_prob >= VOICED_THRESHOLD) & np.isfinite(midi)
    # 반올림 전에 음높이를 눌러 준다. 무음 구간이 이웃 음을 끌어당기지
    # 않도록 노래하는 프레임만 골라 필터를 건다.
    smoothed = _median_smooth(midi, sung, SMOOTH_FRAMES)

    # 반음 단위로 붙인다
    steps = np.where(sung, np.rint(smoothed), np.nan)

    notes: list[Note] = []
    start_idx: int | None = None
    current = np.nan

    def close(end_idx: int) -> None:
        nonlocal start_idx, current
        if start_idx is None or not np.isfinite(current):
            start_idx = None
            return
        start_t = float(times[start_idx])
        end_t = float(times[min(end_idx, len(times) - 1)])
        if end_t - start_t >= MIN_NOTE_SEC:
            notes.append(
                Note(
                    t=round(start_t, 3),
                    end=round(min(end_t, duration), 3),
                    midi=int(current),
                )
            )
        start_idx = None

    for i, step in enumerate(steps):
        if not np.isfinite(step):
            close(i)
            current = np.nan
            continue
        if start_idx is None:
            start_idx, current = i, step
        elif step != current:
            close(i)
            start_idx, current = i, step
    close(len(steps) - 1)

    return _smooth(notes)


def _smooth(notes: list[Note]) -> list[Note]:
    """붙어 있는 같은 음을 잇고, 사이에 낀 아주 짧은 음을 지운다.

    비브라토가 크면 한 음이 60-61-60처럼 갈라진다. 가운데 짧은 음을 빼고
    양옆을 이어 붙이면 사람이 부른 대로의 한 음이 된다.
    """
    if len(notes) < 2:
        return notes

    out: list[Note] = [notes[0]]
    for note in notes[1:]:
        prev = out[-1]
        gap = note.t - prev.end
        if note.midi == prev.midi and gap < 0.08:
            prev.end = note.end
            continue
        out.append(note)

    # 양옆이 같은 음인 짧은 음은 흔들림이다
    cleaned: list[Note] = []
    for i, note in enumerate(out):
        prev = cleaned[-1] if cleaned else None
        nxt = out[i + 1] if i + 1 < len(out) else None
        if (
            prev is not None
            and nxt is not None
            and prev.midi == nxt.midi
            and note.end - note.t < 0.2
            and note.t - prev.end < 0.1
        ):
            continue
        if prev is not None and prev.midi == note.midi and note.t - prev.end < 0.08:
            prev.end = note.end
            continue
        cleaned.append(note)
    return cleaned


def snap_to_beats(notes: list[Note], beat_times: np.ndarray) -> list[Note]:
    """음표 시작을 가장 가까운 반박에 붙인다.

    악보로 읽으려면 음이 박 위에 놓여야 한다. 8분음표까지 표현하도록
    반박 격자를 쓰고, 붙이고 나서 길이가 0이 된 음은 버린다.
    """
    if len(beat_times) < 2 or not notes:
        return notes

    grid = np.asarray(beat_times, dtype=float)
    halves = np.sort(np.concatenate([grid, (grid[:-1] + grid[1:]) / 2.0]))

    def snap(t: float) -> float:
        return float(halves[int(np.argmin(np.abs(halves - t)))])

    out: list[Note] = []
    for note in notes:
        start = snap(note.t)
        end = snap(note.end)
        if end - start < 1e-3:
            continue
        prev = out[-1] if out else None
        if prev and prev.midi == note.midi and abs(prev.end - start) < 1e-3:
            prev.end = end
            continue
        if prev and start < prev.end:
            start = prev.end  # 겹치면 앞 음을 살린다
            if end - start < 1e-3:
                continue
        out.append(Note(t=round(start, 3), end=round(end, 3), midi=note.midi))
    return out
