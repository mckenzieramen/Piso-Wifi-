@echo off
setlocal
cd /d "%~dp0"
echo.
echo PISO WIFI - Deploy Account Recovery Temporary Password Function
echo Firebase project: piso-wifi-f2b5c
echo.
echo If this computer is not authenticated with Firebase, the login step will open a browser.
echo.
call npx firebase-tools@latest login
if errorlevel 1 goto :error
call npx firebase-tools@latest deploy --only functions:setClientTemporaryPassword --project piso-wifi-f2b5c
if errorlevel 1 goto :error
echo.
echo Deployment completed.
pause
exit /b 0
:error
echo.
echo Deployment failed. Check the Firebase CLI output above.
pause
exit /b 1
