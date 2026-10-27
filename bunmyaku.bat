@echo off
rem Windows: double-click to start Bunmyaku with the demo course pack and open the browser.
rem Put your own pack directory after --content, or set BUNMYAKU_CONTENT before running.
cd /d "%~dp0"
if "%BUNMYAKU_CONTENT%"=="" set BUNMYAKU_CONTENT=examples\demo-pack
python -m bunmyaku --content "%BUNMYAKU_CONTENT%" --open %*
pause
