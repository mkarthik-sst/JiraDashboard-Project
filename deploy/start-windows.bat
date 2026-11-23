@echo off
REM smartShift Defect Hub - Windows launcher (run from the project folder after "npm ci" and "npm run build")
cd /d "%~dp0.."
if not exist .env.local (
  echo .env.local not found. Copy .env.example to .env.local and fill in your values, then run this again.
  pause & exit /b 1
)
if not exist .next (
  echo Building first time...
  call npm ci || exit /b 1
  call npm run build || exit /b 1
)
set PORT=3000
start "" http://localhost:3000
call npm run start
