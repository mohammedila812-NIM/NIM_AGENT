"""
native_messaging.py
-------------------
Chrome & Microsoft Edge Native Messaging Host Protocol for NIM AGENT.
Allows Chromium extensions to communicate with the local desktop agent
via high-performance, secure standard I/O pipes (stdin/stdout) without
requiring open local network ports.
"""

import sys
import json
import struct
import logging
import asyncio
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


def read_native_message() -> Optional[Dict[str, Any]]:
    """
    Reads a message from the browser extension via standard input.
    Format: 32-bit uint length prefix (native byte order) followed by JSON UTF-8 payload.
    """
    try:
        raw_length = sys.stdin.buffer.read(4)
        if len(raw_length) < 4:
            return None
        msg_length = struct.unpack("@I", raw_length)[0]
        msg_bytes = sys.stdin.buffer.read(msg_length)
        if len(msg_bytes) < msg_length:
            return None
        return json.loads(msg_bytes.decode("utf-8"))
    except Exception as e:
        logger.error("Error reading native message: %s", e)
        return None


def send_native_message(message: Dict[str, Any]):
    """
    Sends a message to the browser extension via standard output.
    Format: 32-bit uint length prefix followed by JSON UTF-8 payload.
    """
    try:
        encoded = json.dumps(message).encode("utf-8")
        sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
    except Exception as e:
        logger.error("Error sending native message: %s", e)


def run_native_host():
    """
    Main loop for native messaging host when invoked by Chrome/Edge.
    """
    logging.basicConfig(level=logging.INFO)
    logger.info("NIM Native Messaging Host started.")

    while True:
        msg = read_native_message()
        if msg is None:
            break

        msg_type = msg.get("type", "unknown")
        payload = msg.get("payload", {})

        # Echo or route command
        response = {
            "type": f"{msg_type}_response",
            "status": "success",
            "received_payload": payload,
            "host": "nim_native_host_v1"
        }
        send_native_message(response)


if __name__ == "__main__":
    run_native_host()
