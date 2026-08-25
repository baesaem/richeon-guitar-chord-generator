# 리천 기타 코드 자동생성기

YouTube 주소나 오디오 파일에서 **비트·키·코드**를 자동으로 뽑아, 재생과 동기화된
기타 코드 화면을 보여주는 개인용 웹앱.

전체 설계와 일정은 [PLAN.md](PLAN.md) 참고.

## 현재 상태: M3 완료 (폰용 재생 동기화 화면)

YouTube 다운로드 → 디코딩 → 비트/다운비트 → 크로마 → 코드 인식까지 **실제로 동작한다.**
3분 30초 곡 기준 CPU에서 약 9초.

코드 인식은 **Plan A 베이스라인**(24개 템플릿 + Viterbi)이라 장·단3화음만 낸다.
7th·sus·slash 코드와 정확도 향상은 M4에서 사전학습 모델로 교체하며 다룬다.

### 분석 단계
| 모듈 | 하는 일 |
|---|---|
| [decode.py](backend/app/analysis/decode.py) | 무엇이 들어오든 모노 wav로 통일 |
| [features.py](backend/app/analysis/features.py) | 하모닉 성분 분리 → CQT 크로마 → 비트 단위 집계 |
| [beats.py](backend/app/analysis/beats.py) | 비트 추적 + 다운비트 위상 추정 (화성 변화량 + 온셋 세기) |
| [chords.py](backend/app/analysis/chords.py) | 템플릿 상관 → Viterbi 스무딩 → 짧은 파편 병합 |
| [key.py](backend/app/analysis/key.py) | Krumhansl-Schmuckler 조성 추정 |

근음은 백엔드가 항상 샾으로 돌려주고, 조표에 맞춘 플랫 변환은
프론트의 [notation.ts](frontend/lib/notation.ts)가 담당한다. (Ab장조를 G#으로 읽지 않도록)

### 탭 구성 (하단 고정)
| 탭 | 하는 일 |
|---|---|
| 홈 | 주소 입력·파일 업로드 → 분석 → 재생 화면 |
| 재생목록 | 분석해 둔 곡 목록. 다시 열면 캐시가 있어 분석 없이 바로 뜬다 |
| 마이크 | 스피커로 튼 곡이나 직접 친 연주를 녹음해 분석 |
| 코드리스트 | 인식 가능한 코드 24개의 운지 사전 |
| 설정 | 음원 분리, 파형 확대, 코드 표기(♯/♭), 서버 상태 |

홈 탭은 다른 탭으로 옮겨도 DOM에 남겨 둔다. 안 그러면 탭을 바꿀 때마다 재생이 끊긴다.

### 화면 (폰 세로 기준)
- 위쪽 고정: YouTube 플레이어 + 현재 코드(크게) + 운지 다이어그램 + 다음 코드
- 아래: 마디 그리드 4열. 재생 위치를 따라 현재 마디가 화면 가운데로 자동 스크롤
- 업로드한 곡은 백엔드가 원본을 스트리밍하므로 `<audio>`로 재생한다

운지는 코드 사전 없이 [voicings.ts](frontend/lib/voicings.ts)가 CAGED로 만든다.
오픈 코드 8개는 표로 두고 나머지는 E폼·A폼 바레를 옮긴다.
**`/diagrams`** 페이지에서 24개 운지를 한 화면에서 눈으로 확인할 수 있다
(M4에서 7th·sus가 추가되면 폼을 넣고 여기서 검증할 것).

## 요구 사항

| | 버전 | 비고 |
|---|---|---|
| Python | 3.12 (uv가 자동 설치) | 시스템의 3.14는 torch/demucs 휠이 없어 사용 불가 |
| Node | 20+ | |
| ffmpeg | 설치됨 | PATH에 있어야 함 |
| GPU | RTX 5070 Ti | Blackwell(sm_120) → **cu128 이상** torch 휠 필요 |

## 실행

```bash
# 백엔드 (http://localhost:8000)
cd backend
uv sync
uv run python run.py

# 프론트엔드 (http://localhost:3000)
cd frontend
npm install
npm run dev
```

### 폰에서 접속
둘 다 `0.0.0.0`으로 바인딩되어 있다. 같은 공유기에서 **http://192.168.1.199:3000** 으로 접속.
프론트는 접속한 호스트명으로 백엔드 주소를 자동 구성하므로 별도 설정이 필요 없다.
최초 1회 Windows 방화벽에서 3000·8000 포트 인바운드 허용이 필요할 수 있다.

## 운용 모드 (C안: 하이브리드)

| 환경변수 | 기본 | 효과 |
|---|---|---|
| `ENABLE_YOUTUBE` | `true` | `false`면 YouTube URL 입력이 403으로 차단되고 업로드 전용(B안)이 된다 |
| `KEEP_AUDIO_CACHE` | `true` | 원본 오디오를 `backend/cache/audio/`에 남겨 재분석 시 다운로드를 건너뛴다 |
| `DEVICE` | `auto` | `cuda` / `cpu` 강제 지정 |
| `RELOAD` | `false` | 코드 자동 재시작. OneDrive 폴더에서는 변경을 놓치는 일이 잦아 기본은 꺼 둔다 |

`backend/.env`에 넣거나 실행 시 환경변수로 지정한다.
**외부에 배포할 때는 반드시 `ENABLE_YOUTUBE=false`.**

## 캐시

- `backend/cache/audio/{id}.{ext}` — 원본 오디오 (videoId 또는 파일 SHA1 앞 16자)
- `backend/cache/audio/{id}.{sr}.wav` — 분석용 모노 wav (디코딩 결과)
- `backend/cache/audio/{id}.info.json` — 제목·길이 사이드카. 캐시 적중 시 yt-dlp를 다시 부르지 않고도 제목을 복원한다
- `backend/cache/results/{id}.json` — 분석 결과

캐시는 3단으로 걸린다: 결과 → 디코딩 wav → 원본 오디오.
`force: true`는 결과만 무효화하므로, 재분석해도 다운로드와 디코딩은 건너뛴다.

같은 곡을 다시 넣으면 분석을 건너뛴다. 재분석하려면 요청에 `force: true`.
`meta.pipeline_version`이 결과가 어느 버전으로 뽑혔는지 알려준다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 백엔드 상태 · `youtube_enabled` · 연산 장치 |
| POST | `/api/analyze` | `{url, separate, force}` → `{job_id}` |
| POST | `/api/analyze/upload` | multipart 파일 업로드 → `{job_id}` |
| GET | `/api/jobs/{id}` | 현재 진행 상태 |
| GET | `/api/jobs/{id}/events` | SSE 진행률 스트림 |
| GET | `/api/audio/{id}` | 업로드한 원본 오디오 스트리밍 (YouTube는 불필요) |
| GET | `/api/results` | 분석해 둔 곡 목록(요약). 전체 결과는 파형 때문에 무거워 따로 둔다 |
| GET | `/api/results/{id}` | 분석 결과 JSON |
| DELETE | `/api/results/{id}` | 분석 결과 삭제. 오디오는 남아 재분석이 빠르다 |
| PUT | `/api/results/{id}/chords` | 수동 코드 보정 저장 |

종료 이벤트(`done`/`failed`)는 **JobManager만** 발행하며 `result_id`를 포함한다.
파이프라인 단계에서는 종료 이벤트를 쏘지 않는다.

## 개발 시 주의점

- **포트 8000이 안 죽는 경우**: uvicorn `reload=True`는 자식 프로세스를 띄운다.
  부모만 종료하면 자식이 포트를 잡고 있어 옛 코드가 계속 응답한다. 포트 기준으로 정리할 것.
  ```powershell
  Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **yt-dlp는 YouTube 사양 변경으로 주기적으로 깨진다.** 추출이 실패하면 먼저 갱신:
  ```bash
  cd backend && uv pip install -U yt-dlp
  ```
  그래도 안 되면 해당 곡은 파일 업로드로 우회한다.
- OneDrive 동기화 폴더라 `.pyc` 캐시가 소스를 못 따라가는 경우가 있어
  `run.py`에서 바이트코드 캐시를 끈다.
- **Windows에서 `asyncio.create_subprocess_exec`은 못 쓴다.** uvicorn이 SelectorEventLoop을
  쓰면 `NotImplementedError`가 난다. 외부 프로세스는 `asyncio.to_thread` + 동기 `subprocess`로 돌린다
  ([decode.py](backend/app/analysis/decode.py) 참고).

## 다음 단계 (M4)

Demucs 음원 분리 + 사전학습 코드 인식 모델(GPU). 정확도를 실제로 올리는 단계.
