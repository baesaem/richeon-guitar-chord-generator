"""강사님이 곡에 붙여 둔 것들 — 악보 파일과 악보 그림.

재분석은 **코드·박자를 다시 재는 일**이지, 공들여 붙인 악보를 버리는
일이 아니다. 가사가 그렇듯 악보도 그대로 두고 시각만 다시 맞춘다.

붙일 때 원본 파일을 남겨 두므로(악보 파일 `.mscz`, 그림 `.pdf`),
재분석 뒤에는 그 원본을 다시 읽어 새 박자에 맞춘다. 마디선을 찾는 일은
다시 하지 않는다 — 그림은 그대로이고 바뀐 것은 음원의 시각뿐이다.
"""

from __future__ import annotations

from pathlib import Path

from .config import settings
from .schemas import AnalysisResult

#: 악보 파일은 그림과 한자리에 둔다. 이름이 겹치지 않게 __score를 붙인다
#: — 그림 원본은 `{id}.pdf`, 쪽 그림은 `{id}__p0.png`이다.
SCORE_STEM = "__score"


def sheet_dir() -> Path:
    path = settings.result_dir.parent / "sheets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def score_path(result_id: str) -> Path | None:
    """붙여 둔 악보 파일. 없으면 None."""
    for path in sorted(sheet_dir().glob(f"{result_id}{SCORE_STEM}.*")):
        return path
    return None


def save_score_file(result_id: str, data: bytes, suffix: str) -> None:
    """악보 원본을 남긴다 — 재분석 뒤 새 박자에 다시 맞추려면 필요하다."""
    for old in sheet_dir().glob(f"{result_id}{SCORE_STEM}.*"):
        old.unlink(missing_ok=True)
    (sheet_dir() / f"{result_id}{SCORE_STEM}{suffix}").write_bytes(data)


def drop_score_file(result_id: str) -> None:
    for old in sheet_dir().glob(f"{result_id}{SCORE_STEM}.*"):
        old.unlink(missing_ok=True)


def _placed(sheet: dict):
    """저장해 둔 마디 자리를 되살린다.

    마디선을 다시 찾지 않는다. 그림이 바뀐 것이 아니므로 자리는 그대로다.
    """
    from .sheet_score import Placed

    out = []
    for b in sheet.get("bars") or []:
        out.append(
            Placed(
                page=int(b["page"]),
                system=int(b["system"]),
                x0=float(b["x0"]),
                x1=float(b["x1"]),
                top=float(b["top"]),
                bottom=float(b["bottom"]),
                view_top=float(b["viewTop"]),
                view_bottom=float(b["viewBottom"]),
            )
        )
    return out


def restore(result: AnalysisResult, old: dict | None) -> None:
    """재분석으로 새로 만든 결과에 붙여 둔 악보를 되돌려 놓는다.

    `old`는 예전 결과의 날 JSON이다. 파이프라인이 올라가면 예전 결과를
    통째로 버리는데(그래야 개선이 보인다), 붙여 둔 악보는 그 규칙과
    상관이 없다 — 사람이 올린 것이지 우리가 뽑은 것이 아니다. 그래서
    파이프라인 검사를 거치지 않은 날 JSON을 받는다.
    """
    if not old:
        return

    # --- 악보 파일 ---
    # 원본이 남아 있으면 다시 읽어 새 박자에 맞춘다. 마디의 시각이
    # 달라졌으므로 예전 정렬을 그대로 쓰면 커서가 어긋난다.
    path = score_path(result.id)
    if path is not None:
        try:
            from . import score_align, score_file
            from .analysis.asr import transcribe_words

            parsed = score_file.parse(path.read_bytes())
            words = [
                {"text": w.text, "start": w.start, "end": w.end}
                for w in transcribe_words(result.id)
            ]
            result.score = score_file.to_dict(parsed)
            result.score_align = score_align.align(parsed, result.model_dump(), words)
        except Exception:
            # 다시 맞추지 못하면 예전 것이라도 남긴다. 조금 어긋난 악보가
            # 악보가 아예 없는 것보다 낫다 — 강사님이 싱크로 손볼 수 있다.
            result.score = old.get("score") or result.score
            result.score_align = old.get("score_align") or result.score_align
    else:
        result.score = old.get("score") or result.score
        result.score_align = old.get("score_align") or result.score_align

    # --- 악보 그림 ---
    sheet = old.get("sheet")
    if not sheet:
        return
    result.sheet = retime(dict(sheet), result)


def retime(sheet: dict, result: AnalysisResult) -> dict:
    """그림 위 마디는 그대로 두고 시각만 다시 준다."""
    from .sheet_score import times_from_grid, times_from_score

    placed = _placed(sheet)
    if not placed:
        return sheet

    passes = None
    if result.score_align:
        passes = times_from_score(result.score_align, placed)
    if passes:
        sheet["source"] = "score"
    else:
        passes = times_from_grid(
            result.model_dump(),
            len(placed),
            float(sheet.get("offset", 0.0) or 0.0),
            int(sheet.get("repeats", 1) or 1),
        )
        sheet["source"] = "grid"
    sheet["passes"] = passes
    sheet["repeats"] = len(passes)
    return sheet
