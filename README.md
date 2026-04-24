# Frontend Test Console

This frontend is intentionally detached from the backend.

- It lives entirely under `frontend/`
- It does not require backend code changes
- It can be deleted later without affecting the API

## What it does

- inject test detection, sensor, and manual events
- show active incidents
- show event timeline
- simulate a fire scenario in one click
- support a mock mode for UI testing without the backend

## Important Note

Because the backend was kept unchanged, it does not currently expose CORS headers. That means a browser-served frontend may not be able to call the API directly from a different origin.

You have two ways to use this UI:

1. Mock mode

- Open `frontend/index.html`
- Keep the UI in `Mock Mode`
- Test interaction and demo flow entirely in the browser

2. Full browser testing via gateway

- Start the backend on `http://127.0.0.1:8000`
- Start `tools/test_gateway.py`
- Open `http://127.0.0.1:8080`
- Keep the API base URL as `/api`
- Switch to `Backend Mode`

3. Backend mode without the gateway

- Serve the frontend from the same origin as the backend, or put a simple reverse proxy in front of both
- Set the API base URL to your backend address
- Switch to `Backend Mode`

## Recommended Testing Flow

1. Open `frontend/index.html`
2. Select a location from the map
3. Click `Run Fire Scenario`
4. Verify incident escalation in the incidents panel
5. Try a manual trigger to simulate fail-safe override

## Optional Vision Microservice

There is also a separate YOLO-based vision service under `vision/service.py`.

Use it when you want a video source to emit real `fire` and `smoke` detection events into the backend.

Recommended source types:

- webcam index such as `0`
- local `.mp4` file path
- RTSP stream
- direct video stream URL

Avoid relying on a normal YouTube watch-page URL as an OpenCV source. It is usually not directly readable frame-by-frame.
