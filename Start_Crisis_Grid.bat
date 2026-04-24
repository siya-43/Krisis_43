@echo off
title Krisis Loader
echo Starting Krisis Stack...
echo.

:: Change to the directory where the batch file is located
cd /d "%~dp0"

:: Activate venv if it exists
if exist .venv\Scripts\activate (
    echo Activating virtual environment...
    call .venv\Scripts\activate
)

:: Run the local stack
python run_local.py

pause
