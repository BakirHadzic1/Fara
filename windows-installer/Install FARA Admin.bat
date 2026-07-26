@echo off
setlocal

set "APP_NAME=FARA Admin"
set "SOURCE=%~dp0app"
set "TARGET=%LOCALAPPDATA%\FARA Admin"
set "EXE=%TARGET%\FARA Admin.exe"
set "SHORTCUT=%USERPROFILE%\Desktop\FARA Admin.lnk"

echo.
echo Installing FARA Admin...
echo.

if not exist "%SOURCE%\FARA Admin.exe" (
  echo ERROR: App files are missing.
  echo Keep this installer next to the "app" folder and try again.
  pause
  exit /b 1
)

if exist "%TARGET%" (
  rmdir /s /q "%TARGET%"
)

mkdir "%TARGET%" >nul 2>nul
robocopy "%SOURCE%" "%TARGET%" /E >nul

if errorlevel 8 (
  echo ERROR: Copy failed.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('%SHORTCUT%'); $s.TargetPath='%EXE%'; $s.WorkingDirectory='%TARGET%'; $s.IconLocation='%EXE%,0'; $s.Save()"

echo.
echo FARA Admin is installed.
echo Desktop shortcut created: FARA Admin
echo.
pause
