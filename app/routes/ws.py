from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from logger import get_logger
import json

logger = get_logger('routes.ws')
router = APIRouter(tags=["websocket"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    from main import active_websockets
    active_websockets.append(websocket)
    logger.info(f"WebSocket connected. Total connections: {len(active_websockets)}")

    try:
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message.get('type') == 'ping':
                    await websocket.send_text(json.dumps({'type': 'pong'}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        active_websockets.remove(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(active_websockets)}")
