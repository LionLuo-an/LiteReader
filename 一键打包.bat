@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

set "MANIFEST_FILE=lite.reader\manifest"

echo ========================================
echo          轻阅读 一键打包工具
echo ========================================
echo.

REM 读取并设置platform字段
echo [信息] 配置平台类型 (platform)
echo        1 - x86 (默认，直接回车)
echo        2 - arm
set "PLATFORM_INPUT="
set /p "PLATFORM_INPUT=请选择平台类型 (1/x86 或 2/arm): "

REM 修复：重新设计平台判断逻辑，避免延迟扩展解析问题
set "TARGET_PLATFORM=x86"
REM 先判断是否输入了内容
if not "!PLATFORM_INPUT!"=="" (
    REM 单独判断是否为2
    if "!PLATFORM_INPUT!"=="2" (
        set "TARGET_PLATFORM=arm"
    ) else (
        REM 再判断是否为1，非1非空则提示无效
        if not "!PLATFORM_INPUT!"=="1" (
            echo [警告] 输入无效，使用默认值 x86
            set "TARGET_PLATFORM=x86"
        )
    )
)

echo [信息] 将使用平台类型: !TARGET_PLATFORM!
echo.

REM 更新 manifest 中的platform字段
echo [信息] 更新 manifest platform 字段...
powershell -Command "$path = '%MANIFEST_FILE%'; $c = Get-Content $path -Encoding UTF8; $c = $c -replace '^platform=.*', 'platform=!TARGET_PLATFORM!'; Set-Content -Path $path -Value $c -Encoding UTF8"
if %errorlevel% neq 0 (
    echo [错误] 更新 manifest platform 字段失败。
    goto :Error
)
echo [信息] manifest platform 字段已更新为 !TARGET_PLATFORM!
echo.

REM 读取当前版本号
set "CURRENT_VERSION="
for /f "tokens=1,* delims==" %%a in ('findstr /b "version=" "%MANIFEST_FILE%"') do (
    set "CURRENT_VERSION=%%b"
)

if not defined CURRENT_VERSION (
    echo [警告] 无法从 manifest 读取当前版本号，使用默认值 1.0.0
    set "CURRENT_VERSION=1.0.0"
)

echo [信息] 当前版本: %CURRENT_VERSION%
echo.
set /p "NEW_VERSION=请输入新版本号 (直接回车保持 %CURRENT_VERSION%): "

if not defined NEW_VERSION set "NEW_VERSION=%CURRENT_VERSION%"

echo.
echo [信息] 将使用版本号: %NEW_VERSION%
echo.

REM 更新 manifest 中的版本号
echo [信息] 更新 manifest 版本号...
powershell -Command "$path = '%MANIFEST_FILE%'; $c = Get-Content $path -Encoding UTF8; $c = $c -replace '^version=.*', 'version=%NEW_VERSION%'; Set-Content -Path $path -Value $c -Encoding UTF8"
if %errorlevel% neq 0 (
    echo [错误] 更新 manifest 版本号失败。
    goto :Error
)
echo [信息] manifest 版本号已更新为 %NEW_VERSION%
echo.

echo [信息] 同步更新 server/package.json 版本...
call node scripts\sync-version.js
if %errorlevel% neq 0 (
    echo [警告] package.json 版本同步失败，但不影响构建...
)
echo.

echo [信息] 步骤 1: 检查前端依赖...
cd frontend
if not exist package.json goto :SkipFrontend
if exist node_modules (
    echo [信息] 前端依赖已存在。跳过安装。
    goto :FrontendDone
)

echo [信息] 正在安装前端依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] 前端依赖安装失败。
    goto :Error
)

:FrontendDone
cd ..
goto :Build

:SkipFrontend
echo [警告] 未找到 frontend/package.json。
cd ..

:Build
echo [信息] 步骤 2: 执行构建脚本...
if not exist scripts\build.js (
    echo [错误] 未找到 scripts\build.js！
    goto :Error
)

call node scripts\build.js
if %errorlevel% neq 0 (
    echo [错误] 构建脚本执行失败。
    goto :Error
)

echo [信息] 步骤 2.5: 修复文件换行符 (CRLF -> LF)...
if exist scripts\fix_eol.js (
    call node scripts\fix_eol.js
) else (
    echo [警告] 未找到 scripts\fix_eol.js。
)

:Package
echo [信息] 步骤 3: 使用 fnpack 打包...
cd lite.reader
if not exist fnpack.exe (
    echo [警告] lite.reader 目录下未找到 fnpack.exe。
    echo [提示] 请将 fnpack.exe 放入该目录以启用自动打包。
    cd ..
    goto :Success
)

echo [信息] 找到 fnpack.exe。开始打包...
fnpack.exe build .
if %errorlevel% neq 0 (
    echo [错误] fnpack 打包失败。
    cd ..
    goto :Error
)
echo [信息] 移动打包文件到根目录并添加版本号和平台标识...
set "PLATFORM_SUFFIX="
if "!TARGET_PLATFORM!"=="arm" (
    set "PLATFORM_SUFFIX=-arm"
) else (
    set "PLATFORM_SUFFIX=-x86"
)
for %%f in (*.fpk) do (
    set "ORIGINAL_NAME=%%~nf"
    move /Y "%%f" "%~dp0!ORIGINAL_NAME!_%NEW_VERSION%!PLATFORM_SUFFIX!.fpk" >nul 2>&1
    echo [信息] 生成文件: !ORIGINAL_NAME!_%NEW_VERSION%!PLATFORM_SUFFIX!.fpk
)
cd ..

:Success
echo.
echo ========================================
echo [成功] 所有任务已完成！
echo ========================================
goto :End

:Error
echo.
echo ========================================
echo [错误] 发生错误。请查看上方详细信息。
echo ========================================
cd .. 2>nul

:End
pause
exit /b