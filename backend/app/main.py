from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .analysis.pipeline import PIPELINE_VERSION, resolve_device
from .config import settings
from .jobs import load_result, manager, save_result
from .schemas import AnalysisResult, AnalyzeRequest, Chord
from .sources import UploadSource, YouTubeSource
from .sources.youtube import YouTubeUnavailable

app = FastAPI(title="ChordGen API", version=PIPELINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    """프론트가 기동 시 호출. youtube_enabled로 URL 입력창 노출 여부를 결정한다."""
    return {
        "ok": True,
        "youtube_enabled": settings.enable_youtube,
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


@app.get("/api/results/{result_id}")
async def get_result(result_id: str) -> AnalysisResult:
    result = load_result(result_id)
    if result is None:
        raise HTTPException(404, "분석 결과가 없습니다")
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
