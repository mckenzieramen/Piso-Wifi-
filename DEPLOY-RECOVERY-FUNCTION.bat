@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo PISO WIFI - ACCOUNT RECOVERY PASSWORD SERVICE
 echo Firebase project: piso-wifi-f2b5c
 echo Function: setClientTemporaryPassword
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

if not exist "node_modules\firebase-tools" (
  echo Firebase CLI will be run through npx.
)

echo.
echo STEP 1/3 - Firebase login
call npx --yes firebase-tools@latest login
if errorlevel 1 goto :error

echo.
echo STEP 2/3 - Deploying the recovery function
call npx --yes firebase-tools@latest deploy --only functions:setClientTemporaryPassword --project piso-wifi-f2b5c
if errorlevel 1 goto :error

echo.
echo STEP 3/3 - Deployment finished successfully.
echo.
echo Test the Admin recovery flow now:
echo Notifications ^> Account Recovery Request ^> Review ^> Approve ^& Set Password
echo.
pause
exit /b 0

:error
echo.
echo DEPLOYMENT FAILED.
echo Read the Firebase CLI error above and correct the Google/Firebase access issue.
pause
exit /b 1
