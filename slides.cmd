@echo off
rem html-slides local tool. Ignore any python planted in the current folder.
setlocal
set "NoDefaultCurrentDirectoryInExePath=1"
python -X utf8 "%~dp0tools\slides.py" %*
exit /b %ERRORLEVEL%
