"""Basic Pitch로 보컬을 채보한다 — pYIN이 놓치는 음을 메운다.

pYIN은 한 번에 한 음만 따라가는 옛 방식이라, 음이 이어지거나 크게
흔들리면 그 대목을 통째로 놓친다. 실측(네 곡)에서 노래한 시간의
56~88%만 덮었다.

Basic Pitch(스포티파이)는 학습으로 음표의 시작·끝을 짚는다. 같은 잣대로
재었더니 67~88%를 덮었다 — 특히 pYIN이 61개밖에 못 잡던 곡에서
61%→86%로 벌어졌다. 대신 음표 수가 서너 배로 늘어, 한 음이 여러 조각으로
갈리거나 떨림이 음표로 세어지기도 한다. 그래서 여기서는 **받아 오기만**
하고, 다듬는 일은 melody.py의 손질(옥타브 접기·같은 음 잇기·짧은 것
버리기·박에 붙이기)에 그대로 맡긴다.

모델을 못 찾으면 조용히 빈 목록을 준다 — 부르는 쪽이 pYIN으로 물러난다.
"""

from __future__ import annotations

from pathlib import Path

from ..schemas import Note

#: 이보다 짧은 것은 숨소리·자음이다. melody.py와 같은 잣대를 쓴다.
MIN_NOTE_SEC = 0.09
#: 사람 목소리 범위 밖은 반주가 샌 것으로 본다(E2~C6)
MIN_MIDI, MAX_MIDI = 40, 84


def available() -> bool:
    """이 기기에서 Basic Pitch를 쓸 수 있는가."""
    try:
        import basic_pitch  # noqa: F401
        from basic_pitch import ICASSP_2022_MODEL_PATH

        return Path(str(ICASSP_2022_MODEL_PATH)).exists()
    except Exception:
        return False


def transcribe(vocals_path, duration: float) -> list[Note]:
    """보컬 wav → 음표 목록. 다듬지 않은 날것을 준다."""
    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import predict
    except Exception:
        return []

    try:
        _, _, events = predict(str(vocals_path), ICASSP_2022_MODEL_PATH)
    except Exception:
        return []

    notes: list[Note] = []
    for start, end, midi, *_ in events:
        s, e, m = float(start), float(end), int(midi)
        if e - s < MIN_NOTE_SEC or not (MIN_MIDI <= m <= MAX_MIDI):
            continue
        notes.append(Note(t=round(s, 3), end=round(min(e, duration), 3), midi=m))
    notes.sort(key=lambda n: (n.t, n.midi))
    return notes
