import os
import json
import subprocess
import logging
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes

# Load environment variables
load_dotenv()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID")) if os.getenv("ADMIN_ID") else 0

# Setup logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

def run_claude_cli(prompt: str) -> str:
    """
    Run Claude CLI with -p flag and JSON output, return the result field.
    Uses --dangerously-skip-permissions to allow automation.
    """
    try:
        # Command: claude -p "<prompt>" --output-format=json --dangerously-skip-permissions
        cmd = [
            "claude",
            "-p", prompt,
            "--output-format=json",
            "--dangerously-skip-permissions"
        ]
        logger.info(f"Running Claude CLI with prompt: {prompt[:100]}...")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,  # Raise CalledProcessError on non-zero exit
            encoding='utf-8'
        )

        # Parse JSON output
        data = json.loads(result.stdout)

        # Extract the result text from the event stream
        extracted_text = None
        if isinstance(data, list):
            # 1. Search for a 'result' type event
            for event in data:
                if isinstance(event, dict) and event.get('type') == 'result':
                    extracted_text = event.get('result')
                    break

            # 2. Fallback: Search for 'assistant' type event and collect text content
            if extracted_text is None:
                for event in data:
                    if isinstance(event, dict) and event.get('type') == 'assistant':
                        message = event.get('message', {})
                        content = message.get('content', [])
                        if isinstance(content, list):
                            text_parts = [
                                part.get('text', '')
                                for part in content
                                if isinstance(part, dict) and part.get('type') == 'text'
                            ]
                            if text_parts:
                                extracted_text = "\n".join(text_parts)
                                break
        elif isinstance(data, dict) and "result" in data:
            extracted_text = data["result"]

        if extracted_text:
            return extracted_text
        else:
            # Fallback: log raw response at DEBUG level and return a clear error
            logger.debug(f"Could not extract text from JSON structure: {result.stdout}")
            return "Ошибка: ответ от Claude CLI получен, но текст сообщения не найден."

    except subprocess.CalledProcessError as e:
        logger.error(f"Claude CLI failed with return code {e.returncode}: {e.stderr}")
        return f"Ошибка выполнения Claude CLI: {e.stderr}"
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from Claude CLI output: {e}")
        return f"Ошибка парсинга ответа Claude CLI: {result.stdout[:200]}"
    except Exception as e:
        logger.exception("Unexpected error in run_claude_cli")
        return f"Неожиданная ошибка: {str(e)}"

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Security: only allow messages from ADMIN_ID
    user_id = update.effective_user.id
    if user_id != ADMIN_ID:
        logger.warning(f"Unauthorized access attempt from user_id: {user_id}")
        return  # Silently ignore

    # Get the message text
    user_text = update.message.text
    if not user_text:
        await update.message.reply_text("Пожалуйста, отправь текстовое сообщение.")
        return

    logger.info(f"Received message from admin: {user_text[:100]}")

    # Show typing action
    try:
        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    except Exception as e:
        logger.warning(f"Could not send typing action: {e}")

    try:
        # Run the CLI and get the result
        result = run_claude_cli(user_text)

        # Special handling for website links request
        if "дай ссылки на мои сайты" in user_text.lower():
            websites = [
                "https://example.com",  # Replace with your actual websites
                "https://myportfolio.com",
                "https://myblog.com"
            ]
            result = "\n".join(websites)

        # Send final reply (Telegram message limit is 4096 characters)
        await update.message.reply_text(result[:4000])
    except Exception as e:
        logger.exception("Error in handle_message")
        await update.message.reply_text(f"Произошла ошибка: {str(e)}")

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    """Log Errors caused by updates."""
    if isinstance(update, Update) and update.message:
        logger.error(f"Update {update.update_id} caused error {context.error}")
    else:
        logger.error(f"Error happened outside of update: {context.error}")

def main():
    """Start the bot."""
    if not TELEGRAM_TOKEN:
        raise ValueError("TELEGRAM_TOKEN not found in environment variables")
    if ADMIN_ID == 0:
        raise ValueError("ADMIN_ID not set in environment variables")

    application = Application.builder().token(TELEGRAM_TOKEN).connect_timeout(30).read_timeout(30).build()

    # Add handler for text messages
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Register the global error handler
    application.add_error_handler(error_handler)

    # Start the bot
    logger.info("Starting Telegram bot...")
    application.run_polling()

if __name__ == "__main__":
    main()
