import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def extract_result(data, raw_stdout):
    if isinstance(data, list):
        # 1. Look for type == 'result'
        for item in data:
            if isinstance(item, dict) and item.get('type') == 'result':
                return item.get('result')
        
        # 2. Look for type == 'assistant'
        for item in data:
            if isinstance(item, dict) and item.get('type') == 'assistant':
                message = item.get('message', {})
                content = message.get('content', [])
                if isinstance(content, list):
                    text_parts = [part.get('text', '') for part in content if isinstance(part, dict) and part.get('type') == 'text']
                    if text_parts:
                        return "\n".join(text_parts)
    
    elif isinstance(data, dict) and "result" in data:
        return data["result"]

    # Fallback
    logger.debug(f"Raw response for fallback: {raw_stdout}")
    return None

# Test cases
tests = [
    {
        "name": "Result type present",
        "data": [{'type': 'system', 'subtype': 'init'}, {'type': 'result', 'result': 'Hello from result!'}],
        "expected": "Hello from result!"
    },
    {
        "name": "Assistant type present",
        "data": [{'type': 'system', 'subtype': 'init'}, {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Hello from assistant!'}]}}],
        "expected": "Hello from assistant!"
    },
    {
        "name": "Assistant type with multiple text blocks",
        "data": [{'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'Part 1 '}, {'type': 'text', 'text': 'Part 2'}]}}],
        "expected": "Part 1 \nPart 2"
    },
    {
        "name": "Old dict format",
        "data": {"result": "Old format success"},
        "expected": "Old format success"
    },
    {
        "name": "Completely unexpected",
        "data": "Not JSON",
        "expected": None
    }
]

for t in tests:
    res = extract_result(t['data'], "raw stdout")
    print(f"Test {t['name']}: {'PASSED' if res == t['expected'] else 'FAILED (got ' + str(res) + ')'}")
