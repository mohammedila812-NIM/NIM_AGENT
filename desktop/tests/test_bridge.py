import asyncio
import json
import pytest
import websockets
from src.bridge.server import BridgeServer
from src.bridge.protocol import BridgeMessageType, BridgeMessage

@pytest.mark.asyncio
async def test_bridge_auth_and_messaging():
    server = BridgeServer(host="127.0.0.1", port=7439)
    await server.start()

    try:
        uri = f"ws://{server.host}:{server.port}"

        # 1. Test unauthorized rejection
        async with websockets.connect(uri) as ws:
            unauth_msg = BridgeMessage(
                type=BridgeMessageType.AUTH_REQUEST,
                payload={},
                auth_token="wrong_token"
            )
            await ws.send(json.dumps(unauth_msg.to_dict()))
            resp = json.loads(await ws.recv())
            assert resp["type"] == "error"

        # 2. Test successful authentication
        async with websockets.connect(uri) as ws:
            auth_msg = BridgeMessage(
                type=BridgeMessageType.AUTH_REQUEST,
                payload={},
                auth_token=server.auth_token
            )
            await ws.send(json.dumps(auth_msg.to_dict()))
            resp = json.loads(await ws.recv())
            assert resp["type"] == "auth_response"
            assert resp["payload"]["status"] == "authenticated"

    finally:
        await server.stop()
