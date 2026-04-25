@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

if "%~1"=="" (
  echo run-service.cmd: missing service name argument
  exit /b 2
)

if "%~2"=="" (
  echo run-service.cmd: missing port argument
  exit /b 2
)

set "SERVICE=%~1"
set "SERVICE=%SERVICE:"=%"
set "PORT=%~2"
set "PORT=%PORT:"=%"

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"

set "ENV_FILE=%REPO_ROOT%\infra\docker\.env"
set "ENV_EXAMPLE=%REPO_ROOT%\infra\docker\.env.example"
if not exist "%ENV_FILE%" (
  if not exist "%ENV_EXAMPLE%" (
    echo run-service.cmd: missing env template "%ENV_EXAMPLE%"
    exit /b 1
  )
  copy /Y "%ENV_EXAMPLE%" "%ENV_FILE%" >nul
)

set "POSTGRES_USER="
set "POSTGRES_PASSWORD="
for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  if /i "%%A"=="POSTGRES_USER" set "POSTGRES_USER=%%B"
  if /i "%%A"=="POSTGRES_PASSWORD" set "POSTGRES_PASSWORD=%%B"
)

if not defined POSTGRES_USER set "POSTGRES_USER=kis"
if not defined POSTGRES_PASSWORD set "POSTGRES_PASSWORD=kis_local_password"

set "DB_NAME=%SERVICE:-=_%"
set "SERVICE_DIR=%REPO_ROOT%\services\%SERVICE%"
if not exist "%SERVICE_DIR%\cmd\api\main.go" (
  echo run-service.cmd: service entrypoint not found "%SERVICE_DIR%\cmd\api\main.go"
  exit /b 1
)
set "EXE_PATH=%REPO_ROOT%\bin\%SERVICE%.exe"
set "CHECK_SCRIPT=%REPO_ROOT%\scripts\dev\check-service-binary.ps1"
if not exist "%CHECK_SCRIPT%" (
  echo run-service.cmd: preflight script not found "%CHECK_SCRIPT%"
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%CHECK_SCRIPT%" -Service "%SERVICE%" -RepoRoot "%REPO_ROOT%"
if errorlevel 1 exit /b %ERRORLEVEL%

set "TMP_DIR=%SERVICE_DIR%\.tmp"
set "CACHE_DIR=%TMP_DIR%\go-cache"
if not exist "%TMP_DIR%" mkdir "%TMP_DIR%" >nul 2>nul
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%" >nul 2>nul
set "KIS_DOCKER_DIR=%REPO_ROOT%\infra\docker"
set "KIS_DOCKER_COMPOSE_FILE=%KIS_DOCKER_DIR%\docker-compose.yml"

set "DB_HOST=localhost"
set "DB_PORT=5432"
set "DB_USER=%POSTGRES_USER%"
set "DB_PASSWORD=%POSTGRES_PASSWORD%"
set "DB_NAME=%DB_NAME%"
set "DB_SSLMODE=disable"
set "DB_PING_TIMEOUT=5s"
set "SERVER_PORT=%PORT%"
if /I "%SERVICE%"=="finance-invoicing" (
  set "FINANCE_INVOICING_DEV_SEED_ENABLED=true"
) else (
  set "FINANCE_INVOICING_DEV_SEED_ENABLED="
)
if /I "%SERVICE%"=="finance-reporting" (
  set "FINANCE_REPORTING_DEV_SEED_ENABLED=true"
) else (
  set "FINANCE_REPORTING_DEV_SEED_ENABLED="
)
if /I "%SERVICE%"=="service-parts-usage" if not defined PERSISTENCE_STRICT set "PERSISTENCE_STRICT=false"
set "GOTELEMETRY=off"
set "TMP=%TMP_DIR%"
set "TEMP=%TMP_DIR%"
set "GOTMPDIR=%TMP_DIR%"
set "GOCACHE=%CACHE_DIR%"

pushd "%SERVICE_DIR%"
"%EXE_PATH%"
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
