"""인프로세스 잡 큐.

단일 사용자 로컬 앱이므로 Redis/Celery를 두지 않는다.
동시 분석은 GPU 메모리를 고려해 1건으로 제한한다.
"""

from __future__ import annotations

import asyncio
import traceback
import uuid
from typing import AsyncIterator

from .analysis.pipeline import PIPELINE_VERSION, analyze
from .config import settings
from .lyrics import align_to_vocals, fetch_lyrics_blocking
from .schemas import AnalysisResult, JobStage, JobStatus, SourceKind
from .sources.base import AudioSource

_MAX_CONCURRENT = 1


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, JobStatus] = {}
        # 구독자가 늦게 붙어도 처음부터 재생할 수 있도록 이벤트를 모두 보관한다.
        self._history: dict[str, list[JobStatus]] = {}
        self._updated: dict[str, asyncio.Event] = {}
        self._finished: set[str] = set()
        self._sem = asyncio.Semaphore(_MAX_CONCURRENT)

    def get(self, job_id: str) -> JobStatus | None:
        return self._jobs.get(job_id)

    def submit(self, source: AudioSource, *, separate: bool, force: bool) -> str:
        job_id = uuid.uuid4().hex[:12]
        initial = JobStatus(job_id=job_id, stage=JobStage.QUEUED)
        self._jobs[job_id] = initial
        self._history[job_id] = [initial]
        self._updated[job_id] = asyncio.Event()
        asyncio.create_task(self._run(job_id, source, separate, force))
        return job_id

    async def _publish(self, job_id: str, status: JobStatus) -> None:
        self._jobs[job_id] = status
        self._history[job_id].append(status)
        self._updated[job_id].set()

    async def _run(
        self, job_id: str, source: AudioSource, separate: bool, force: bool
    ) -> None:
        async def progress(stage: JobStage, value: float, message: str) -> None:
            await self._publish(
                job_id,
                JobStatus(job_id=job_id, stage=stage, progress=value, message=message),
            )

        try:
            async with self._sem:
                audio = await source.fetch(progress)

                cached = None if force else load_result(audio.id)
                if cached is not None:
                    await self._publish(
                        job_id,
                        JobStatus(
                            job_id=job_id,
                            stage=JobStage.DONE,
                            progress=1.0,
                            message="캐시된 분석 결과 사용",
                            result_id=audio.id,
                        ),
                    )
                    return

                result = await analyze(audio, progress, separate=separate)

                # 가사를 미리 찾아 둔다(웹 가사 → YouTube 자막 순).
                # 없으면 그냥 넘어간다 — 부가 정보라 분석을 실패시키지 않는다.
                await progress(JobStage.POSTPROCESS, 0.95, "가사 찾는 중")
                result.lyrics, result.lyrics_approx = await asyncio.to_thread(
                    fetch_lyrics_blocking,
                    audio.id if audio.kind == SourceKind.YOUTUBE else None,
                    result.title,
                    result.duration,
                )
                # 자막에서 온 가사는 노래보다 늦다. 보컬 트랙에 맞춰 당긴다.
                if result.lyrics and separate:
                    result.lyrics = await asyncio.to_thread(
                        align_to_vocals, result.lyrics, audio.id
                    )

                save_result(result)

                if not settings.keep_audio_cache:
                    audio.path.unlink(missing_ok=True)

                await self._publish(
                    job_id,
                    JobStatus(
                        job_id=job_id,
                        stage=JobStage.DONE,
                        progress=1.0,
                        message="완료",
                        result_id=result.id,
                    ),
                )
        except Exception as exc:
            traceback.print_exc()
            await self._publish(
                job_id,
                JobStatus(
                    job_id=job_id,
                    stage=JobStage.FAILED,
                    message="분석 실패",
                    error=str(exc),
                ),
            )
        finally:
            self._finished.add(job_id)
            self._updated[job_id].set()

    async def stream(self, job_id: str) -> AsyncIterator[JobStatus]:
        history = self._history.get(job_id)
        if history is None:
            return
        sent = 0
        while True:
            while sent < len(history):
                yield history[sent]
                sent += 1
            if job_id in self._finished:
                return
            self._updated[job_id].clear()
            await self._updated[job_id].wait()


# --- 결과 캐시 (파일 기반. 단일 사용자라 DB가 필요 없다) ---

def result_path(result_id: str):
    return settings.result_dir / f"{result_id}.json"


def load_result(result_id: str) -> AnalysisResult | None:
    path = result_path(result_id)
    if not path.exists():
        return None
    try:
        result = AnalysisResult.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return None  # 스키마가 바뀐 옛 캐시는 무시하고 재분석

    # 파이프라인이 올라갔으면 옛 결과는 버린다. 안 그러면 모델을 바꿔도
    # 캐시 때문에 예전 결과가 계속 나와 개선을 확인할 수 없다.
    if result.meta.pipeline_version != PIPELINE_VERSION:
        return None
    return result


def save_result(result: AnalysisResult) -> None:
    result_path(result.id).write_text(
        result.model_dump_json(indent=2), encoding="utf-8"
    )


manager = JobManager()
