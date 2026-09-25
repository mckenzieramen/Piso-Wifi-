@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo PISO WIFI - CUSTOM PASSWORD RESET EMAIL FIX
 echo ==============================================
echo.
echo Deploying Firebase functions:
echo   clientLogin
echo   sendCustomPasswordReset
echo.
echo Make sure you are already logged in to Firebase CLI.
echo.

firebase deploy --only functions:clientLogin,functions:sendCustomPasswordReset

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
echo Now upload the website files to Cloudflare Pages.
echo Test Forgot Password with a real Client ID and registered Gmail.
echo.
pause
