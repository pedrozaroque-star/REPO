@echo off
python analyze_assistant_data.py > analysis_result.txt 2>&1
if %errorlevel% neq 0 (
    echo Command failed with error level %errorlevel% >> analysis_result.txt
)
