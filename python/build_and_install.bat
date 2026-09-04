@echo off
setlocal

REM Build and install blink detector standalone binary (Windows)

echo Building and installing blink detector standalone binary...

set "SCRIPT_DIR=%~dp0"

if not exist "%SCRIPT_DIR%venv\" (
	echo ERROR: Virtual environment not found. Please run setup.bat first.
	exit /b 1
)

call "%SCRIPT_DIR%venv\Scripts\activate.bat"
if errorlevel 1 (
	echo ERROR: Failed to activate virtual environment
	exit /b 1
)

python -c "import PyInstaller" 2>nul
if errorlevel 1 (
	echo Installing PyInstaller...
	pip install pyinstaller
	if errorlevel 1 exit /b 1
)

echo Building binary...
python "%SCRIPT_DIR%build_binary.py"
if errorlevel 1 exit /b 1

echo Testing binary...
python "%SCRIPT_DIR%test_binary.py"
if errorlevel 1 exit /b 1

echo Installing binary to Electron resources...
python "%SCRIPT_DIR%install_binary.py"
if errorlevel 1 exit /b 1

echo SUCCESS: Build and installation complete!
endlocal
exit /b 0
