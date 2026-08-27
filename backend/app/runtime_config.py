"""화면에서 바꾸는 설정.

.env는 서버를 다시 켜야 반영된다. API 키처럼 사용자가 앱 안에서 넣고
바로 쓰고 싶은 값은 여기에 따로 담는다.

키는 서버에만 둔다. 브라우저에는 앞뒤 몇 글자만 가린 형태로 보내고,
키 자체를 내려보내지 않는다 — 화면을 누가 열어 봐도 키가 새지 않는다.
"""

from __future__ import annotations

import json
from typing import Any

from .config import settings

_PATH = settings.result_dir.parent / "runtime.json"


def _read() -> dict[str, Any]:
    try:
        return json.loads(_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write(data: dict[str, Any]) -> None:
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    _PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def llm_config() -> dict[str, str]:
    """화면에서 넣은 값이 있으면 그것을, 없으면 .env 값을 쓴다."""
    saved = _read().get("llm", {})
    return {
        "api_key": saved.get("api_key") or settings.llm_api_key,
        "base_url": saved.get("base_url") or settings.llm_base_url,
        "model": saved.get("model") or settings.llm_model,
    }


def save_llm_config(
    *, api_key: str | None = None, base_url: str | None = None, model: str | None = None
) -> None:
    """None은 "그대로 두기", 빈 문자열은 "지우기"로 읽는다."""
    data = _read()
    llm = data.setdefault("llm", {})
    for field, value in (("api_key", api_key), ("base_url", base_url), ("model", model)):
        if value is None:
            continue
        if value == "":
            llm.pop(field, None)
        else:
            llm[field] = value.strip()
    _write(data)


def mask(secret: str) -> str:
    """키를 화면에 보일 형태로 가린다. 있는지 없는지만 알아보면 된다."""
    if not secret:
        return ""
    if len(secret) <= 12:
        return "•" * len(secret)
    return f"{secret[:6]}…{secret[-4:]}"
