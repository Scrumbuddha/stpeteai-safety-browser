@echo off
rem VS Code terminals set ELECTRON_RUN_AS_NODE, which makes Electron act as plain Node.
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
