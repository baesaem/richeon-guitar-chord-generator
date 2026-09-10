@echo off
setlocal enabledelayedexpansion
rem  리천 기타교실 분석 서버 - 지키미
rem
rem  서버가 꺼져 있으면 켜고, 꺼지면 5초 뒤 다시 켠다. 이미 8000번을
rem  쓰는 서버가 있으면 건드리지 않고 기다린다(두 벌이 함께 뜨면 서로
rem  잡아먹는다).
rem
rem  .venv 파이썬이 안 뜨면 uv로 한 번 더 켠다. 지키미가 한 번 물리면
rem  같은 실패를 5초마다 되풀이하며 며칠을 보낼 수 있다 - 실제로 9월 3일
rem  부터 이레 동안 「No Python at ...」만 적으며 돌았고, 그동안 강사님
rem  화면에서는 단추가 모두 꺼져 있었다. 다른 길이 하나는 있어야 한다.
rem
rem  로그는 %TEMP% 폴더의 richeon-backend.log 에 쌓인다. 5MB가 넘으면
rem  지운다 - 열어 볼 수 없을 만큼 커지면 로그가 아니다. 파이썬은 -u로
rem  띄운다 - 파일로 내보내면 출력을 모아 두었다 한꺼번에 써서, 서버가
rem  죽은 까닭이 로그에 닿기 전에 사라진다.
rem
rem  기다리기는 ping으로 한다. 숨은 창(server-hidden.vbs)에서는 timeout이
rem  기다리지 않고 곧바로 끝나, 실패가 쉬지 않고 되풀이된다.
rem
rem  이 파일은 cp949로 저장한다 - cmd가 한글을 그 코드로 읽는다.
cd /d "%~dp0"
set "LOG=%TEMP%\richeon-backend.log"
set "PY=%~dp0.venv\Scripts\python.exe"
set "ARGS=-u -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

:loop
for %%F in ("%LOG%") do if %%~zF GTR 5000000 del "%LOG%" > nul 2>&1

netstat -ano | findstr ":8000 " | findstr LISTENING > nul
if not errorlevel 1 (
  ping -n 31 127.0.0.1 > nul
  goto loop
)

echo. >> "%LOG%"
echo ===== %date% %time% start ===== >> "%LOG%"
"%PY%" %ARGS% >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ----- .venv 파이썬으로 못 떴습니다. uv로 다시 켭니다 ----- >> "%LOG%"
  uv run --project "%~dp0" python %ARGS% >> "%LOG%" 2>&1
)
echo ===== %date% %time% stopped, restarting in 5s ===== >> "%LOG%"
ping -n 6 127.0.0.1 > nul
goto loop
