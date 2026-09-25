@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo PISO WIFI - CUSTOM PASSWORD RESET DEPLOYMENT
echo Firebase project: piso-wifi-f2b5c
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

if not exist "firestore.rules" (
  echo ERROR: firestore.rules was not found.
  pause
  exit /b 1
)

echo.
echo STEP 1/3 - Firebase login
call npx --yes firebase-tools@latest login
if errorlevel 1 goto :error

echo.
echo STEP 2/3 - Deploying password-reset and recovery functions
call npx --yes firebase-tools@latest deploy --only functions:sendCustomPasswordReset,functions:setClientTemporaryPassword --project piso-wifi-f2b5c
if errorlevel 1 goto :error

echo.
echo STEP 3/3 - Deploying Firestore rules
call npx --yes firebase-tools@latest deploy --only firestore:rules --project piso-wifi-f2b5c
if errorlevel 1 goto :error

echo.
echo ============================================================
echo DEPLOYMENT FINISHED SUCCESSFULLY
 echo ============================================================
echo.
echo Next: test Client Login - Forgot Password.
echo.
pause
exit /b 0

:error
echo.
echo ============================================================
echo DEPLOYMENT FAILED
 echo ============================================================
echo Read the Firebase CLI error above.
echo.
pause
exit /b 1
