@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo PISO WIFI - PASSWORD RESET + RECOVERY BACKEND DEPLOYMENT
echo Firebase project: piso-wifi-f2b5c
echo Functions: sendCustomPasswordReset + setClientTemporaryPassword
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)

where npx >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm/npx is not available.
  pause
  exit /b 1
)

if not exist "functions\package.json" (
  echo ERROR: functions\package.json was not found.
  pause
  exit /b 1
)

echo.
echo STEP 1/4 - Firebase login
call npx --yes firebase-tools@latest login
if errorlevel 1 goto :error

echo.
echo STEP 2/4 - Installing Firebase Function dependencies
cd /d "%~dp0functions"
call npm install
if errorlevel 1 goto :error
cd /d "%~dp0"

echo.
echo STEP 3/4 - Deploying BOTH password-recovery functions
call npx --yes firebase-tools@latest deploy --only functions:sendCustomPasswordReset,functions:sendCustomPasswordResetHttp,functions:setClientTemporaryPassword --project piso-wifi-f2b5c
if errorlevel 1 goto :error

echo.
echo STEP 4/4 - Backend deployment finished

echo.
echo IMPORTANT:
echo The customer website now calls the Firebase sendCustomPasswordReset HTTPS function directly.
echo Cloudflare Pages no longer needs the password-reset proxy route.
echo Both functions are now deployed by this script.
echo.
echo Next test:
echo Client Login ^> Forgot Password ^> matching Client ID + Gmail ^> Send Reset Link

echo.
pause
exit /b 0

:error
echo.
echo DEPLOYMENT FAILED.
echo Read the Firebase/Node error above. Do not delete existing data.
echo.
pause
exit /b 1
