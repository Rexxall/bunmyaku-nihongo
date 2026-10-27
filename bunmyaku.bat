@echo off
rem Windows: double-click to start Bunmyaku with the demo course pack and open the browser.
rem Put your own pack directory after --content, or set BUNMYAKU_CONTENT before running.
cd /d "%~dp0"
if "%BUNMYAKU_CONTENT%"=="" set BUNMYAKU_CONTENT=examples\demo-pack
rem Prefer the py launcher: on many PCs "python" only opens the Microsoft Store.
set "BUNMYAKU_PY=python"
where py >NUL 2>NUL && set "BUNMYAKU_PY=py -3"
%BUNMYAKU_PY% -m bunmyaku --content "%BUNMYAKU_CONTENT%" --open %*
pause
