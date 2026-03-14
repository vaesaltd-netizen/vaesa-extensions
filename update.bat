@echo off
chcp 65001 >nul
title VAESA Extension - Cập nhật

echo ==========================================
echo   VAESA Extension - Auto Update
echo ==========================================
echo.
echo Đang tải bản mới nhất từ GitHub...

:: Tạo thư mục tạm
set "TEMP_DIR=%~dp0_update_temp"
set "ZIP_FILE=%TEMP_DIR%\latest.zip"
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

:: Tải zip từ GitHub
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/vaesaltd-netizen/vaesa-extensions/archive/refs/heads/main.zip' -OutFile '%ZIP_FILE%'"

if not exist "%ZIP_FILE%" (
    echo.
    echo [LỖI] Không tải được. Kiểm tra kết nối mạng!
    pause
    exit /b 1
)

echo Đang giải nén...

:: Giải nén
powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP_DIR%' -Force"

:: Copy file mới đè lên file cũ
echo Đang cập nhật...
set "EXTRACTED=%TEMP_DIR%\vaesa-extensions-main"

if not exist "%EXTRACTED%" (
    echo.
    echo [LỖI] Giải nén thất bại!
    pause
    exit /b 1
)

copy /y "%EXTRACTED%\manifest.json" "%~dp0manifest.json" >nul
copy /y "%EXTRACTED%\background.js" "%~dp0background.js" >nul
copy /y "%EXTRACTED%\content.js" "%~dp0content.js" >nul
copy /y "%EXTRACTED%\content.css" "%~dp0content.css" >nul
copy /y "%EXTRACTED%\injected.js" "%~dp0injected.js" >nul

:: Dọn dẹp
rmdir /s /q "%TEMP_DIR%"

echo.
echo ==========================================
echo   CẬP NHẬT THÀNH CÔNG!
echo ==========================================
echo.
echo Bước tiếp theo:
echo   1. Mở Chrome → chrome://extensions
echo   2. Bấm nút 🔄 (reload) trên extension
echo   3. F5 lại trang Pancake
echo.
pause
