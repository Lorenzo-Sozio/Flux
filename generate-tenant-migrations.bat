@echo off
cd /d "%~dp0"
echo Generating tenant migrations...
npm run generate:tenant-migrations
pause
