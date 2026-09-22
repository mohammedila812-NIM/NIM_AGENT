import asyncio
import json
import logging
import secrets
import time
from typing import Any, Callable, Dict, Optional, Set
import websockets
try:
    from websockets.asyncio.server import serve, ServerConnection
    WebSocketConnection = ServerConnection
except ImportError:
    from websockets.server import serve, WebSocketServerProtocol
    WebSocketConnection = WebSocketServerProtocol
from src.config import DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT
from src.security.secrets import get_secret_store
from .protocol import (
    BridgeMessage,
    BridgeMessageType,
    BrowserResultPayload,
    BrowserTaskPayload
)

logger = logging.getLogger(__name__)

class BridgeServer:
    """
    WebSocket Server hosting the Browser Bridge.
    Connects NIM JARVIS Desktop to the NIM Agent browser extension.
    Requires per-session auth token pairing.
    """

    def __init__(
        self,
        host: str = DEFAULT_BRIDGE_HOST,
        port: int = DEFAULT_BRIDGE_PORT
    ):
        self.host = host
        self.port = port
        self.secret_store = get_secret_store()
        self.auth_token = self._init_auth_token()
        self._connected_clients: Set[Any] = set()
        self._authenticated_clients: Set[Any] = set()
        self._pending_tasks: Dict[str, asyncio.Future[BrowserResultPayload]] = {}
        self._server = None
        self._is_running = False
        self.on_handoff_callback: Optional[Callable[[Dict[str, object]], None]] = None

    def _init_auth_token(self) -> str:
        token = self.secret_store.get_key("bridge_auth_token")
        if not token:
            token = f"nim_pair_{secrets.token_hex(16)}"
            self.secret_store.set_key("bridge_auth_token", token)
        return token

    async def start(self):
        """Starts the WebSocket bridge server."""
        if self._is_running:
            return
        self._server = await websockets.serve(self._handle_connection, self.host, self.port)
        self._is_running = True
        logger.info("Browser Bridge WebSocket Server started on ws://%s:%d", self.host, self.port)

    async def stop(self):
        """Stops the WebSocket bridge server."""
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._is_running = False
            logger.info("Browser Bridge WebSocket Server stopped.")

    @property
    def is_client_connected(self) -> bool:
        self._authenticated_clients = {c for c in self._authenticated_clients if getattr(c, 'open', True) and not getattr(c, 'closed', False)}
        return len(self._authenticated_clients) > 0

    async def _handle_connection(self, websocket: Any):
        authenticated = False
        self._connected_clients.add(websocket)
        logger.info("New connection from browser extension: %s", getattr(websocket, "remote_address", "client"))

        try:
            async for raw_msg in websocket:
                try:
                    data = json.loads(raw_msg)
                    msg_type = data.get("type")
                    token = str(data.get("auth_token", "")).strip().strip('"').strip("'")
                    payload = data.get("payload", {})

                    # 1. Handle Auth Handshake
                    if msg_type == BridgeMessageType.AUTH_REQUEST.value:
                        if token and token == self.auth_token.strip():
                            authenticated = True
                            self._authenticated_clients.add(websocket)
                            resp = BridgeMessage(
                                type=BridgeMessageType.AUTH_RESPONSE,
                                payload={"status": "authenticated", "server_version": "0.1.0"},
                                auth_token=self.auth_token
                            )
                            await websocket.send(json.dumps(resp.to_dict()))
                            logger.info("Browser extension authenticated successfully.")
                        else:
                            logger.warning("Bridge auth failed. Expected '%s', got '%s'", self.auth_token, token)
                            resp = BridgeMessage(
                                type=BridgeMessageType.ERROR,
                                payload={"message": "Invalid authentication pairing token."}
                            )
                            await websocket.send(json.dumps(resp.to_dict()))
                            await websocket.close(4001, "Unauthorized")
                            return
                        continue

                    # Require authentication for all further messages
                    if not authenticated:
                        err_resp = BridgeMessage(
                            type=BridgeMessageType.ERROR,
                            payload={"message": "Must authenticate before sending commands."}
                        )
                        await websocket.send(json.dumps(err_resp.to_dict()))
                        continue

                    # 2. Handle Browser Results
                    if msg_type == BridgeMessageType.BROWSER_RESULT.value:
                        task_id = payload.get("task_id")
                        if task_id and task_id in self._pending_tasks:
                            result_payload = BrowserResultPayload(
                                task_id=task_id,
                                success=bool(payload.get("success", False)),
                                summary=str(payload.get("summary", "")),
                                extracted_data=payload.get("extracted_data"),
                                screenshots=payload.get("screenshots", []),
                                error=payload.get("error")
                            )
                            fut = self._pending_tasks.pop(task_id)
                            if not fut.done():
                                fut.set_result(result_payload)

                    # 3. Handle Handoff Requests (e.g. CAPTCHA detected on web)
                    elif msg_type == BridgeMessageType.HANDOFF_REQUEST.value:
                        if self.on_handoff_callback:
                            self.on_handoff_callback(payload)

                    # 4. Handle Ping
                    elif msg_type == BridgeMessageType.PING.value:
                        pong = BridgeMessage(type=BridgeMessageType.PONG, payload={"ack": time.time()})
                        await websocket.send(json.dumps(pong.to_dict()))

                except Exception as e:
                    logger.error("Error processing bridge message: %s", e)

        finally:
            self._connected_clients.discard(websocket)
            self._authenticated_clients.discard(websocket)
            logger.info("Browser extension disconnected.")

    async def delegate_browser_task(
        self,
        goal: str,
        context: Optional[Dict[str, object]] = None,
        timeout: int = 120
    ) -> BrowserResultPayload:
        """
        Sends a browser automation goal to the connected NIM Agent browser extension
        and awaits the structured result.
        """
        if not self.is_client_connected:
            return BrowserResultPayload(
                task_id="",
                success=False,
                summary="Browser extension is not connected.",
                error="No active NIM Agent browser extension connected on WebSocket bridge."
            )

        import uuid
        task_id = f"btask_{uuid.uuid4().hex[:8]}"
        task_payload = BrowserTaskPayload(
            task_id=task_id,
            goal=goal,
            context=context or {},
            timeout_seconds=timeout
        )

        msg = BridgeMessage(
            type=BridgeMessageType.BROWSER_TASK,
            payload={
                "task_id": task_payload.task_id,
                "goal": task_payload.goal,
                "context": task_payload.context,
                "timeout_seconds": task_payload.timeout_seconds
            },
            auth_token=self.auth_token
        )

        loop = asyncio.get_running_loop()
        future: asyncio.Future[BrowserResultPayload] = loop.create_future()
        self._pending_tasks[task_id] = future

        # Send to primary active authenticated browser extension
        raw = json.dumps(msg.to_dict())
        sent = False
        for client in list(self._authenticated_clients):
            try:
                await client.send(raw)
                sent = True
                break  # Target single active extension instance
            except Exception as e:
                logger.warning("Failed to send to client: %s", e)
                self._authenticated_clients.discard(client)

        if not sent:
            self._pending_tasks.pop(task_id, None)
            return BrowserResultPayload(
                task_id=task_id,
                success=False,
                summary="Failed to transmit task to browser client.",
                error="No active browser extension responded to transmission."
            )

        try:
            return await asyncio.wait_for(future, timeout=float(timeout))
        except asyncio.TimeoutError:
            self._pending_tasks.pop(task_id, None)
            return BrowserResultPayload(
                task_id=task_id,
                success=False,
                summary="Browser task timed out.",
                error=f"Task timed out after {timeout} seconds."
            )

_global_bridge_server: Optional[BridgeServer] = None

def get_bridge_server() -> BridgeServer:
    global _global_bridge_server
    if _global_bridge_server is None:
        _global_bridge_server = BridgeServer()
    return _global_bridge_server
