"""인프로세스 잡 큐.

단일 사용자 로컬 앱이므로 Redis/Celery를 두지 않는다.
동시 분석은 GPU 메모리를 고려해 1건으로 제한한다.
"""

from __future__ import annotations

import asyncio
import json
import traceback
import uuid
from typing import AsyncIterator

from . import attachments
from .analysis.pipeline import PIPELINE_VERSION, analyze
from .config import settings
from .lyrics import fetch_lyrics_blocking, polish_captions, sync_to_song
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
                # 사람이 넣거나 고친 가사는 지운 채 덮지 않는다. 재분석은
                # 코드·박자를 새로 재는 일이지 공들여 맞춘 가사를 버리는
                # 일이 아니다. 그대로 두고 아래에서 싱크만 다시 맞춘다.
                old = load_result(audio.id)
                if old and old.lyrics_manual and old.lyrics:
                    result.lyrics = old.lyrics
                    result.lyrics_approx = old.lyrics_approx
                    result.lyrics_manual = True
                else:
                    result.lyrics, result.lyrics_approx, lyric_source = (
                        await asyncio.to_thread(
                            fetch_lyrics_blocking,
                            audio.id if audio.kind == SourceKind.YOUTUBE else None,
                            result.title,
                            result.duration,
                        )
                    )
                    # 자막에서 온 가사는 토막나 있고 글자가 틀린다. AI 키가
                    # 있으면 분석하면서 바로 소절로 다듬는다 — 매 곡 단추를
                    # 눌러야 한다면 분석이 덜 끝난 것이다.
                    if lyric_source == "captions" and result.lyrics:
                        result.lyrics = await asyncio.to_thread(
                            polish_captions, result.lyrics
                        )
                    # 웹에도 자막에도 없으면 노래에서 직접 받아 적는다.
                    # 분리해 둔 보컬 트랙이 있어야 한다(원곡 반주가 섞이면
                    # 못 알아듣는다).
                    if not result.lyrics and separate:
                        from .analysis.asr import lines_from_words, transcribe_words

                        await progress(JobStage.POSTPROCESS, 0.96, "가사 받아 적는 중")
                        words = await asyncio.to_thread(transcribe_words, audio.id)
                        if words:
                            result.lyrics = lines_from_words(words)
                            result.lyrics_approx = False
                # 시각을 실제 부른 자리에 맞춘다(받아 적은 단어 시각 →
                # 없으면 보컬 시작점 스냅).
                # 수동 가사도 글자만 지키고 시각은 다시 잰다.
                if result.lyrics and separate:
                    await progress(JobStage.POSTPROCESS, 0.97, "가사 싱크 맞추는 중")
                    result.lyrics = await asyncio.to_thread(
                        sync_to_song, result.lyrics, audio.id
                    )

                # 강사님이 붙여 둔 악보는 재분석이 지우지 않는다. 새 박자에
                # 맞춰 시각만 다시 준다 — 가사와 같은 규칙이다.
                await progress(JobStage.POSTPROCESS, 0.98, "붙여 둔 악보 잇는 중")
                await asyncio.to_thread(
                    attachments.restore, result, _raw_result(audio.id)
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


def _raw_result(result_id: str) -> dict | None:
    """예전 결과를 날 것으로 읽는다.

    load_result는 파이프라인이 올라가면 None을 준다(그래야 캐시 때문에
    개선이 묻히지 않는다). 그런데 강사님이 붙인 악보는 그 규칙과 상관이
    없다 — 사람이 올린 것이지 우리가 뽑은 것이 아니다.
    """
    path = result_path(result_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_result(result: AnalysisResult) -> None:
    result_path(result.id).write_text(
        result.model_dump_json(indent=2), encoding="utf-8"
    )


manager = JobManager()
