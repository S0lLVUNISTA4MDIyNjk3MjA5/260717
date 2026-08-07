@echo off
setlocal EnableExtensions
chcp 65001 >nul

rem ---------------------------------------------------------------------
rem P2-A3 Private Dictionary Candidate Review UI - Windows launcher
rem
rem This script does not install anything and never writes any file
rem anywhere in this package folder (no log, no cache, no marker file).
rem It only reads files under this folder, picks the bundled Node.js
rem runtime that matches this machine's CPU architecture, verifies its
rem identity, and starts "node app\server.js", which serves the review
rem UI to 127.0.0.1 only and opens it in your browser. Close this window,
rem or press Ctrl+C in it, to stop the server; nothing is left running.
rem
rem All paths below are resolved relative to this script's own location
rem (%~dp0), so it works no matter what folder you launched it from.
rem ---------------------------------------------------------------------

title P2-A3 Private Dictionary Candidate Review UI

set "PKGROOT=%~dp0"
set "EXPECTED_VERSION=v24.14.0"
set "HASH_X64=63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088"
set "HASH_ARM64=8c5fd45a4a1fd3cc4a6f07da8803b05194108906cb6fb7d962448a12582a5922"

rem --- Best-effort warning: opening a .cmd straight from inside Explorer's
rem     ZIP view (without extracting first) runs it from a throwaway temp
rem     copy. This never blocks execution; it only prints a hint. ---
set "TEMPWARN=0"
if /i "%PKGROOT%"=="%TEMP%\" set "TEMPWARN=1"
echo "%PKGROOT%" | findstr /I /C:"\Temp\" >nul && set "TEMPWARN=1"
if "%TEMPWARN%"=="1" (
  echo [WARNING] This folder looks like a temporary location.
  echo [WARNING] If you opened the ZIP file directly in File Explorer
  echo [WARNING] instead of extracting it, right-click the ZIP and choose
  echo [WARNING] "Extract All..." to a normal folder first, then run this
  echo [WARNING] script again from that extracted folder.
  echo.
)

rem --- CPU architecture detection. PROCESSOR_ARCHITECTURE reports the
rem     architecture of THIS cmd.exe process, which is x86 when a 32-bit
rem     cmd host runs under WOW64 on 64-bit Windows; PROCESSOR_ARCHITEW6432
rem     then holds the real (native) architecture. Checking both avoids
rem     misdetecting 64-bit Windows as x86. ---
set "ARCH="
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "ARCH=x64"
if not defined ARCH if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=arm64"
if not defined ARCH if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "ARCH=x64"

if not defined ARCH (
  echo [ERROR] This tool supports 64-bit Windows on x64 or ARM64 only.
  echo [ERROR] Category: UNSUPPORTED_ARCHITECTURE
  goto :fail
)

set "NODE_EXE=%PKGROOT%runtime\win-%ARCH%\node.exe"
set "EXPECTED_HASH="
if "%ARCH%"=="x64" set "EXPECTED_HASH=%HASH_X64%"
if "%ARCH%"=="arm64" set "EXPECTED_HASH=%HASH_ARM64%"

rem --- Existence check ---
if not exist "%NODE_EXE%" (
  echo [ERROR] The bundled Node.js runtime for this architecture is missing.
  echo [ERROR] Category: RUNTIME_MISSING
  goto :fail
)

rem --- Integrity check via certutil (avoids a hard PowerShell dependency) ---
set "ACTUAL_HASH="
for /f "skip=1 delims=" %%H in ('certutil -hashfile "%NODE_EXE%" SHA256 2^>nul') do (
  if not defined ACTUAL_HASH (
    echo %%H| findstr /R "^[0-9a-fA-F ]*$" >nul && set "ACTUAL_HASH=%%H"
  )
)
if defined ACTUAL_HASH set "ACTUAL_HASH=%ACTUAL_HASH: =%"
if not defined ACTUAL_HASH (
  echo [ERROR] Could not compute the runtime integrity hash.
  echo [ERROR] Category: HASH_CHECK_FAILED
  goto :fail
)
if /i not "%ACTUAL_HASH%"=="%EXPECTED_HASH%" (
  echo [ERROR] The bundled Node.js runtime failed an integrity check.
  echo [ERROR] Category: RUNTIME_INTEGRITY_MISMATCH
  goto :fail
)

rem --- Version check ---
set "ACTUAL_VERSION="
for /f "delims=" %%V in ('"%NODE_EXE%" --version 2^>nul') do if not defined ACTUAL_VERSION set "ACTUAL_VERSION=%%V"
if not defined ACTUAL_VERSION (
  echo [ERROR] Could not run the bundled Node.js runtime.
  echo [ERROR] Category: RUNTIME_LAUNCH_FAILED
  goto :fail
)
if /i not "%ACTUAL_VERSION%"=="%EXPECTED_VERSION%" (
  echo [ERROR] The bundled Node.js runtime reported an unexpected version.
  echo [ERROR] Category: RUNTIME_VERSION_MISMATCH
  goto :fail
)

if not exist "%PKGROOT%app\server.js" (
  echo [ERROR] The application files are missing from this package.
  echo [ERROR] Category: APP_MISSING
  goto :fail
)

echo Starting the P2-A3 Private Dictionary Candidate Review UI...
echo A browser window will open automatically at http://127.0.0.1:...
echo Close this window, or press Ctrl+C here, to stop the server.
echo.
"%NODE_EXE%" "%PKGROOT%app\server.js"
goto :eof

:fail
echo.
echo The review UI could not be started. See the message above.
echo For help, see README_JA.html in this folder (troubleshooting section).
pause
exit /b 1
