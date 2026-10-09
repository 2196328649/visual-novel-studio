@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Visual Novel Studio - Development
pushd "%~dp0"
if errorlevel 1 goto failed

for %%N in (node.exe) do set "VNS_NODE=%%~$PATH:N"
if not defined VNS_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "VNS_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined VNS_NODE (
    echo Node.js 22.12 or newer was not found.
    echo Install Node.js or restore the existing Codex development runtime.
    popd
    goto failed
)

set "ELECTRON_RUN_AS_NODE="
"%VNS_NODE%" "%~dp0scripts\dev.mjs"
set "VNS_EXIT_CODE=%errorlevel%"
popd
if "%VNS_EXIT_CODE%"=="0" exit /b 0

:failed
echo.
echo Visual Novel Studio could not start. See the error above.
echo Startup log: "%~dp0artifacts\dev-launcher.log"
pause
exit /b 1
