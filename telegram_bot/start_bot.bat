@echo off
cd /d "C:\Users\4\Desktop\cc\telegram_bot"
echo Starting Claude Telegram Bot...
"C:\Users\4\Desktop\cc\telegram_bot\venv\Scripts\python.exe" bot.py >> bot_output.log 2>&1
pause