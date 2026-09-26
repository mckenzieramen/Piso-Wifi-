@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo PISO WIFI - CUSTOMER LOGIN FIX
 echo ==============================================
echo.

echo This deploys the new Firebase callable function:
echo   clientLogin
 echo.
echo Make sure you are already logged in to Firebase CLI.
echo.

firebase deploy --only functions:clientLogin

if errorlevel 1 (
  echo.
  echo DEPLOYMENT FAILED.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo DEPLOYMENT COMPLETE
 echo ==============================================
echo.
echo Now upload the website files from this ZIP to Cloudflare Pages.
echo Then test Username / Client ID / Registered Gmail login.
echo.
pause
