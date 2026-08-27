from __future__ import annotations

import asyncio
import json
import re
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from sse_starlette.sse import EventSourceResponse

from .analysis.decode import encode_mp3, ffmpeg_available
from .analysis.pipeline import PIPELINE_VERSION, resolve_device
from .analysis.separate import instrumental_path, separate
from .config import settings
from .jobs import load_result, manager, result_path, save_result
from .lyrics import fetch_lyrics_blocking
from .llm import pick_model, rank_models
from .runtime_config import llm_config, mask, save_llm_config
from .sheets import clean_query, search as search_sheets
from .schemas import (
    AnalysisResult,
    AnalyzeRequest,
    ReanalyzeRequest,
    Chord,
    LlmSettings,
    LyricLine,
    ResultSummary,
    SourceKind,
)
from .shared_drive import download_shared, list_shared
from .sources import UploadSource, YouTubeSource
from .sources.base import AudioSource
from .sources.cached import CachedSource, find_source_audio
from .sources.youtube import YouTubeUnavailable

app = FastAPI(title="리천 기타 코드 자동 생성기 API", version=PIPELINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _guard_id(result_id: str) -> None:
    """경로 조작 차단. id는 videoId 또는 파일 해시라 구분자가 들어갈 일이 없다."""
    if "/" in result_id or "\\" in result_id or ".." in result_id:
        raise HTTPException(400, "잘못된 id입니다")


@app.get("/api/health")
async def health() -> dict:
    """프론트가 기동 시 호출. youtube_enabled로 URL 입력창 노출 여부를 결정한다."""
    ffmpeg_ok = ffmpeg_available()
    return {
        "ok": ffmpeg_ok,
        "youtube_enabled": settings.enable_youtube,
        "ffmpeg": ffmpeg_ok,
        "device": resolve_device(),
        "pipeline_version": PIPELINE_VERSION,
    }


@app.post("/api/analyze")
async def analyze_url(req: AnalyzeRequest) -> dict:
    if not req.url:
        raise HTTPException(400, "url이 필요합니다")
    try:
        source = YouTubeSource(req.url)
    except YouTubeUnavailable as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    job_id = manager.submit(source, separate=req.separate, force=req.force)
    return {"job_id": job_id}


@app.post("/api/analyze/upload")
async def analyze_upload(
    file: UploadFile = File(...),
    separate: bool = Form(True),
    force: bool = Form(False),
) -> dict:
    suffix = Path(file.filename or "audio").suffix
    # 캐시 디렉터리 안에 임시파일을 만들어 같은 볼륨에서 rename이 일어나게 한다.
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, dir=settings.audio_dir
    ) as tmp:
        while chunk := await file.read(1 << 20):
            tmp.write(chunk)
        tmp_path = Path(tmp.name)

    source = UploadSource(tmp_path, file.filename or "audio")
    job_id = manager.submit(source, separate=separate, force=force)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str) -> dict:
    status = manager.get(job_id)
    if status is None:
        raise HTTPException(404, "잡을 찾을 수 없습니다")
    return status.model_dump()


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str) -> EventSourceResponse:
    if manager.get(job_id) is None:
        raise HTTPException(404, "잡을 찾을 수 없습니다")

    async def gen():
        async for status in manager.stream(job_id):
            yield {"event": "status", "data": json.dumps(status.model_dump())}

    return EventSourceResponse(gen())


@app.get("/api/results")
async def list_results() -> list[ResultSummary]:
    """분석해 둔 곡 목록. 최근 분석 순."""
    summaries: list[ResultSummary] = []
    for path in settings.result_dir.glob("*.json"):
        result = load_result(path.stem)
        if result is None:
            continue  # 스키마·버전이 안 맞는 옛 캐시는 목록에 올리지 않는다
        summaries.append(
            ResultSummary(
                id=result.id,
                source=result.source,
                title=result.title,
                duration=result.duration,
                bpm=result.bpm,
                key=result.key,
                chord_count=len(result.chords),
                pipeline_version=result.meta.pipeline_version,
                analyzed_at=path.stat().st_mtime,
            )
        )

    summaries.sort(key=lambda s: s.analyzed_at, reverse=True)
    return summaries


@app.delete("/api/results/{result_id}")
async def delete_result(result_id: str) -> dict:
    """분석 결과만 지운다. 원본·디코딩 오디오는 남아 재분석이 빠르다."""
    _guard_id(result_id)

    path = result_path(result_id)
    if not path.exists():
        raise HTTPException(404, "분석 결과가 없습니다")
    path.unlink()
    return {"deleted": result_id}


# ---- 설정 (화면에서 바꾸는 값) ----

@app.get("/api/settings/llm")
async def get_llm_settings() -> dict:
    """가사 도우미 설정. 키는 가려서 보낸다."""
    cfg = llm_config()
    return {
        "configured": bool(cfg["api_key"]),
        "masked_key": mask(cfg["api_key"]),
        "base_url": cfg["base_url"],
        "model": cfg["model"],
    }


@app.put("/api/settings/llm")
async def put_llm_settings(body: LlmSettings) -> dict:
    """키·주소·모델을 저장한다. 빈 문자열을 보내면 지운다."""
    save_llm_config(
        api_key=body.api_key, base_url=body.base_url, model=body.model
    )
    return await get_llm_settings()


@app.post("/api/settings/llm/test")
async def test_llm_settings() -> dict:
    """저장된 키로 실제 호출해 본다. 쓸 수 있는 모델 목록도 함께 준다."""
    cfg = llm_config()
    if not cfg["api_key"]:
        raise HTTPException(400, "API 키가 없습니다")

    def probe() -> dict:
        import urllib.request

        req = urllib.request.Request(
            f"{cfg['base_url'].rstrip('/')}/models",
            headers={"Authorization": f"Bearer {cfg['api_key']}"},
        )
        with urllib.request.urlopen(req, timeout=settings.llm_timeout) as res:
            data = json.load(res)
        rows = data.get("data", [])
        return {
            "count": len(rows),
            "models": rank_models(rows),
            "all": [str(m.get("id", "")) for m in rows],
        }

    try:
        found = await asyncio.to_thread(probe)
    except Exception as exc:
        raise HTTPException(502, f"연결하지 못했습니다: {exc}") from exc

    chat = found["models"]
    recommended = pick_model(chat)
    ok = cfg["model"] in found["all"]
    return {
        "ok": True,
        "model_available": ok,
        "message": (
            f"연결됨 · 모델 {found['count']}개"
            + ("" if ok else f" · '{cfg['model']}'는 이 키로 쓸 수 없습니다")
        ),
        "models": chat[:40],
        "recommended": recommended,
    }


# 내가 가진 악보를 곡에 붙여 둔다. 이미지(png·jpg)와 PDF만 받는다.
_SHEET_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
_SHEET_MAX_BYTES = 20 * 1024 * 1024


def _sheet_dir():
    path = settings.result_dir.parent / "sheets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _my_sheet(result_id: str) -> Path | None:
    for path in sorted(_sheet_dir().glob(f"{result_id}.*")):
        return path
    return None


@app.get("/api/sheets/{result_id}/mine")
async def get_my_sheet(result_id: str) -> Response:
    """등록해 둔 악보. 없으면 404."""
    _guard_id(result_id)

    path = _my_sheet(result_id)
    if path is None:
        raise HTTPException(404, "등록된 악보가 없습니다")
    # PDF는 브라우저가 바로 펼쳐 보도록 inline으로 준다
    return FileResponse(path, content_disposition_type="inline")


@app.post("/api/sheets/{result_id}/mine")
async def put_my_sheet(result_id: str, file: UploadFile = File(...)) -> dict:
    """악보 파일을 곡에 붙인다. 한 곡에 하나만 둔다."""
    _guard_id(result_id)

    suffix = _SHEET_TYPES.get(file.content_type or "")
    if suffix is None:
        raise HTTPException(400, "이미지(PNG·JPG·WEBP)나 PDF만 올릴 수 있습니다")

    data = await file.read(_SHEET_MAX_BYTES + 1)
    if len(data) > _SHEET_MAX_BYTES:
        raise HTTPException(413, "파일이 너무 큽니다 (20MB까지)")

    for old in _sheet_dir().glob(f"{result_id}.*"):
        old.unlink(missing_ok=True)
    (_sheet_dir() / f"{result_id}{suffix}").write_bytes(data)
    return {"ok": True, "kind": "pdf" if suffix == ".pdf" else "image"}


@app.delete("/api/sheets/{result_id}/mine")
async def delete_my_sheet(result_id: str) -> dict:
    _guard_id(result_id)

    path = _my_sheet(result_id)
    if path is None:
        raise HTTPException(404, "등록된 악보가 없습니다")
    path.unlink(missing_ok=True)
    return {"deleted": result_id}


@app.get("/api/sheets/{result_id}")
async def find_sheets(result_id: str) -> dict:
    """이 곡의 코드 악보가 올라와 있는 페이지들을 찾는다.

    악보 자체를 가져오지 않는다 — 남이 만든 악보를 복제해 보여주면
    저작권에 걸린다. 어디에 있는지만 알려 주고 사용자가 그 사이트에서 본다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    items = await asyncio.to_thread(search_sheets, result.title)
    return {"query": clean_query(result.title), "items": items}


@app.get("/api/shared")
async def shared_list() -> list[dict]:
    """강상기타반 공유 폴더의 파일 목록."""
    try:
        files = await list_shared()
    except Exception as exc:
        raise HTTPException(502, f"공유 폴더를 읽지 못했습니다: {exc}") from exc
    return [{"id": f.id, "name": f.name} for f in files]


@app.get("/api/shared/{file_id}")
async def shared_file(file_id: str) -> Response:
    """공유 폴더의 파일 내용. 프론트가 받아 기기 저장 재생목록에 넣는다."""
    try:
        data = await download_shared(file_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"내려받기 실패: {exc}") from exc
    return Response(content=data, media_type="application/octet-stream")


@app.get("/api/audio/{result_id}")
async def get_audio(result_id: str) -> FileResponse:
    """업로드한 곡을 브라우저에서 재생하기 위한 원본 스트리밍.

    YouTube 결과는 IFrame 플레이어로 재생하므로 이 경로를 쓰지 않는다.
    """
    _guard_id(result_id)

    path = _source_audio(result_id)
    if path is None:
        raise HTTPException(404, "오디오를 찾을 수 없습니다")
    # 파일명(확장자)을 헤더로 알려줘 프론트가 음원 내보내기 이름을 지을 수 있게 한다
    return FileResponse(path, filename=path.name)


def _source_audio(result_id: str) -> Path | None:
    """원본 오디오 파일. 디코딩 산출물·사이드카·분리 스템은 건너뛴다."""
    for path in sorted(settings.audio_dir.glob(f"{result_id}.*")):
        rest = path.name[len(result_id) + 1 :]
        if "." in rest:
            continue
        return path
    return None


def _instrumental_mp3(result_id: str) -> Path:
    """재생·공유용 반주. wav는 4분 곡이 50MB라 폰으로 스트리밍하기 무겁다."""
    return settings.audio_dir / f"{result_id}.instrumental.mp3"


@app.get("/api/audio/{result_id}/instrumental")
async def get_instrumental(result_id: str) -> FileResponse:
    """보컬을 뺀 반주 트랙. 없으면 404 — 프론트가 만들기를 요청한다."""
    _guard_id(result_id)

    for path in (_instrumental_mp3(result_id), instrumental_path(result_id)):
        if path.exists():
            return FileResponse(path, filename=path.name)
    raise HTTPException(404, "반주 트랙이 아직 없습니다")


@app.post("/api/audio/{result_id}/instrumental")
async def make_instrumental(result_id: str) -> dict:
    """원본을 분리해 반주 트랙을 만든다. 이미 있으면 그대로 쓴다.

    GPU에서 4분 곡이 10초 안쪽이라 요청을 붙잡고 기다리게 둔다.
    """
    _guard_id(result_id)

    mp3 = _instrumental_mp3(result_id)
    if mp3.exists():
        return {"ready": True, "cached": True}

    wav = instrumental_path(result_id)
    if not wav.exists():
        source = _source_audio(result_id)
        if source is None:
            raise HTTPException(404, "원본 오디오가 없습니다. 곡을 다시 분석해 주세요")
        try:
            await separate(source, result_id, resolve_device())
        except Exception as exc:
            raise HTTPException(500, f"반주를 만들지 못했습니다: {exc}") from exc
        if not wav.exists():
            raise HTTPException(500, "반주 트랙 생성에 실패했습니다")

    # mp3로 줄여 두고 wav는 남긴다(재분리 없이 다시 인코딩할 수 있게).
    try:
        await encode_mp3(wav, mp3)
    except Exception:
        return {"ready": True, "cached": False}  # 인코딩이 안 되면 wav로 서빙된다
    return {"ready": True, "cached": False}


@app.get("/api/results/{result_id}")
async def get_result(result_id: str) -> AnalysisResult:
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    return result


def _purge_derived(result_id: str, *, include_source: bool) -> int:
    """이 곡에서 만들어 둔 파일을 지운다. 몇 개 지웠는지 돌려준다.

    디코딩본(`{id}.22050.wav`)·분리 스템·반주 mp3가 대상이다. 음원을 다시
    받을 때는 이것들이 옛 소리에서 나온 것이라 반드시 같이 지워야 한다.
    """
    removed = 0
    for path in settings.audio_dir.glob(f"{result_id}.*"):
        rest = path.name[len(result_id) + 1 :]
        is_derived = "." in rest
        if is_derived or include_source:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


@app.post("/api/results/{result_id}/reanalyze")
async def reanalyze(result_id: str, req: ReanalyzeRequest) -> dict:
    """이미 등록된 곡을 다시 분석한다.

    파이프라인이 좋아졌거나 결과가 마음에 안 들 때 쓴다. 기본은 받아 둔
    음원을 그대로 쓰므로 빠르다(내려받기 단계가 통째로 빠진다).

    refetch=true면 음원부터 다시 받는다. YouTube가 영상을 바꿔 올렸거나
    받다가 깨진 경우다. 업로드 곡은 다시 받을 곳이 없어 거절한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    # 서버에서 지웠지만 기기에는 남아 있는 곡이 있다. 그럴 때 화면이
    # 알려 준 정보로 되살린다 — YouTube 곡은 id만 알면 다시 받을 수 있다.
    kind = result.source if result else req.source
    title = result.title if result else req.title
    if kind is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    if req.refetch:
        if kind != SourceKind.YOUTUBE:
            raise HTTPException(
                400, "업로드한 곡은 다시 받을 곳이 없습니다. 파일을 새로 올려 주세요"
            )
        if not settings.enable_youtube:
            raise HTTPException(403, "이 서버는 YouTube 입력이 꺼져 있습니다")
        _purge_derived(result_id, include_source=True)
        source: AudioSource = YouTubeSource(f"https://www.youtube.com/watch?v={result_id}")
    else:
        path = find_source_audio(result_id)
        if path is None:
            # 음원도 없다. YouTube 곡이면 받아 오면 되고, 업로드 곡은 방법이 없다
            if kind != SourceKind.YOUTUBE or not settings.enable_youtube:
                raise HTTPException(404, "받아 둔 음원이 없습니다")
            source = YouTubeSource(f"https://www.youtube.com/watch?v={result_id}")
        else:
            # 디코딩본과 분리 스템은 지운다. 남겨 두면 옛 산출물을 그대로 쓴다
            _purge_derived(result_id, include_source=False)
            source = CachedSource(result_id, kind, path, title)

    job_id = manager.submit(source, separate=req.separate, force=True)
    return {"job_id": job_id}


@app.post("/api/results/{result_id}/lyrics")
async def fetch_lyrics(result_id: str, q: str = "") -> AnalysisResult:
    """이미 분석된 곡에 가사를 붙인다(웹 가사 → YouTube 자막 순).

    분석과 분리해 둔 이유: 가사는 나중에 올라오기도 하고, 옛 결과에도
    가사만 새로 채울 수 있어야 한다.
    """
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")

    lyrics, approx = await asyncio.to_thread(
        fetch_lyrics_blocking,
        result_id if result.source == "youtube" else None,
        result.title,
        result.duration,
        q,
    )
    if not lyrics:
        raise HTTPException(404, "이 곡의 가사를 찾지 못했습니다")

    result.lyrics = lyrics
    result.lyrics_approx = approx
    save_result(result)
    return result


@app.put("/api/results/{result_id}/lyrics")
async def put_lyrics(result_id: str, lyrics: list[LyricLine]) -> AnalysisResult:
    """가사를 직접 넣는다(사용자가 올린 .lrc/자막 파일)."""
    _guard_id(result_id)

    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    result.lyrics = lyrics
    # 사용자가 직접 넣은 가사는 어림이 아니다. 시각이 파일에 들어 있다
    result.lyrics_approx = False
    save_result(result)
    return result


@app.put("/api/results/{result_id}/chords")
async def edit_chords(result_id: str, chords: list[Chord]) -> AnalysisResult:
    """수동 코드 보정 저장 (M6). 오인식을 사용자가 직접 고친다."""
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
    result.chords = chords
    save_result(result)
    return result
