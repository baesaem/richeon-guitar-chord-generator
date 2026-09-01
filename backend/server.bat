@echo off
rem  리천 기타교실 분석 서버 - 지키는 문지기
rem
rem  서버가 꺼져 있으면 켜고, 죽으면 5초 뒤 다시 켠다. 이미 8000번을
rem  누가 쓰고 있으면 건드리지 않고 기다린다(두 벌이 뜨면 서로 방해한다).
rem
rem  로그는 %TEMP% 폴더의 richeon-backend.log 에 쌓인다.
rem  이 파일은 cp949로 저장한다 - cmd가 한글을 그 코드로 읽는다.
cd /d "%~dp0"
set "LOG=%TEMP%\richeon-backend.log"

:loop
netstat -ano | findstr ":8000 " | findstr LISTENING > nul
if not errorlevel 1 (
  timeout /t 30 /nobreak > nul
  goto loop
)

echo. >> "%LOG%"
echo ===== %date% %time% start ===== >> "%LOG%"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> "%LOG%" 2>&1
echo ===== %date% %time% stopped, restarting in 5s ===== >> "%LOG%"
timeout /t 5 /nobreak > nul
goto loop
