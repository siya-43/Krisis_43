from __future__ import annotations

import json
import mimetypes
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

from flask import Flask, jsonify, request, Response
import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - optional dependency
    cv2 = None

try:
    from ultralytics import YOLO
except ImportError:  # pragma: no cover - optional dependency
    YOLO = None


VISION_PORT = 8010

# Shared-source deduplication: tracks last emit time per (source, label) pair
# so cameras sharing the same physical device don't spam different locations.
_source_emit_lock = threading.Lock()
_source_last_emit: dict[tuple[str, str], float] = {}


@dataclass(slots=True)
class VisionConfig:
    source: str = "0"
    location: str = "Corridor A"
    camera_id: str = "cam-03"
    model_path: str = "vision/models/best.pt"
    confidence: float = 0.45
    frame_stride: int = 3
    emit_interval_seconds: float = 2.0
    backend_url: str = "http://127.0.0.1:8000"
    enable_fallback_heuristics: bool = True


@dataclass(slots=True)
class VisionState:
    running: bool = False
    configured: bool = False
    ready: bool = False
    last_error: str | None = None
    last_frame_seen_at: str | None = None
    last_emit_at: str | None = None
    last_detections: list[dict[str, Any]] = field(default_factory=list)
    emitted_events: int = 0
    frames_processed: int = 0


class DetectorRuntime:
    def __init__(self) -> None:
        self.config = VisionConfig()
        self.state = VisionState()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.RLock()
        self._last_emit_by_label: dict[str, float] = {}
        self._latest_frame_jpg: bytes | None = None
        self._refresh_readiness()

    def configure(self, payload: dict[str, Any]) -> None:
        with self._lock:
            source = str(payload.get("source", self.config.source)).strip()
            location = str(payload.get("location", self.config.location)).strip()
            camera_id = str(payload.get("camera_id", self.config.camera_id)).strip()
            model_path = str(payload.get("model_path", self.config.model_path)).strip()
            backend_url = str(payload.get("backend_url", self.config.backend_url)).strip().rstrip("/")

            confidence = float(payload.get("confidence", self.config.confidence))
            frame_stride = int(payload.get("frame_stride", self.config.frame_stride))
            emit_interval = float(payload.get("emit_interval_seconds", self.config.emit_interval_seconds))
            enable_fallback_heuristics = bool(
                payload.get("enable_fallback_heuristics", self.config.enable_fallback_heuristics)
            )

            if not source:
                raise ValueError("source is required")
            if not location:
                raise ValueError("location is required")
            if not camera_id:
                raise ValueError("camera_id is required")
            if not model_path:
                raise ValueError("model_path is required")
            if confidence <= 0 or confidence > 1:
                raise ValueError("confidence must be between 0 and 1")
            if frame_stride < 1:
                raise ValueError("frame_stride must be at least 1")
            if emit_interval < 0:
                raise ValueError("emit_interval_seconds must be >= 0")
            if not backend_url.startswith("http://") and not backend_url.startswith("https://"):
                raise ValueError("backend_url must start with http:// or https://")

            self.config = VisionConfig(
                source=source,
                location=location,
                camera_id=camera_id,
                model_path=model_path,
                confidence=confidence,
                frame_stride=frame_stride,
                emit_interval_seconds=emit_interval,
                backend_url=backend_url,
                enable_fallback_heuristics=enable_fallback_heuristics,
            )
            self.state.configured = True
            self.state.last_error = None
            self._refresh_readiness()

    def start(self) -> None:
        with self._lock:
            self._refresh_readiness()
            if not self.state.ready:
                raise RuntimeError(self.state.last_error or "Vision runtime not ready")
            if self.state.running:
                return
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, name="vision-detector", daemon=True)
            self.state.running = True
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2)
        with self._lock:
            self.state.running = False

    def detect_once(self) -> list[dict[str, Any]]:
        self._refresh_readiness()
        if not self.state.ready:
            raise RuntimeError(self.state.last_error or "Vision runtime not ready")
        self._stop_event.clear()
        return self._process_source(single_frame=True)

    def snapshot(self) -> dict[str, Any]:
        self._refresh_readiness()
        with self._lock:
            return {
                "config": asdict(self.config),
                "state": asdict(self.state),
                "notes": {
                    "youtube_page_urls": "A normal YouTube page URL is not a reliable OpenCV source. Use a local mp4, webcam index, RTSP stream, or a direct stream URL.",
                    "labels_supported": ["fire", "smoke"],
                },
            }

    def _refresh_readiness(self) -> None:
        missing: list[str] = []
        if YOLO is None:
            missing.append("ultralytics")
        if cv2 is None:
            missing.append("opencv-python")
        with self._lock:
            self.state.ready = not missing
            if missing:
                self.state.last_error = f"Missing dependencies: {', '.join(missing)}"

    def _run_loop(self) -> None:
        try:
            self._process_source(single_frame=False)
        except Exception as exc:  # pragma: no cover - runtime safeguard
            with self._lock:
                self.state.last_error = str(exc)
                self.state.running = False

    def _process_source(self, single_frame: bool) -> list[dict[str, Any]]:
        model = YOLO(self.config.model_path)
        source = self._parse_source(self.config.source)
        capture = cv2.VideoCapture(source)
        if not capture.isOpened():
            raise RuntimeError(f"Could not open video source: {self.config.source}")

        detections_for_return: list[dict[str, Any]] = []
        frame_index = 0

        try:
            while not self._stop_event.is_set():
                ok, frame = capture.read()
                if not ok:
                    if single_frame:
                        raise RuntimeError("No frame available from source")
                    
                    # If it's a file, loop it for demo purposes safely
                    if isinstance(source, str) and not source.isdigit() and source.endswith('.mp4'):
                        capture.release()
                        capture = cv2.VideoCapture(source)
                        ok, frame = capture.read()
                        if not ok:
                            break
                    else:
                        break

                # Yield CPU to allow other threads to run, especially when processing local files at max speed
                time.sleep(0.01)

                # Resize immediately to save CPU on plotting and encoding
                # Balance: 640x480 is needed for accurate fire detection, but simplified loop keeps it fast
                frame = cv2.resize(frame, (640, 480))

                frame_index += 1
                if frame_index % self.config.frame_stride != 0:
                    continue

                with self._lock:
                    self.state.frames_processed += 1
                    self.state.last_frame_seen_at = self._now_iso()

                results = model(frame, conf=self.config.confidence, verbose=False)
                
                annotated_frame = results[0].plot() if len(results) > 0 and hasattr(results[0], 'plot') else frame
                # Lower quality encoding (40%) to save massive CPU for the 6-camera wall
                _, buffer = cv2.imencode('.jpg', annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 40])
                jpg_bytes = buffer.tobytes()

                labels = self._extract_detections(results)

                # Restore fast heuristic fallback if YOLO finds nothing
                if not labels and self.config.enable_fallback_heuristics:
                    labels = self._fallback_detections(frame)

                with self._lock:
                    self.state.last_detections = labels
                    self._latest_frame_jpg = jpg_bytes

                if labels:
                    detections_for_return = labels
                    self._emit_detections(labels)

                if single_frame:
                    return labels

            return detections_for_return
        finally:
            capture.release()
            if not single_frame:
                with self._lock:
                    self.state.running = False

    def _extract_detections(self, results: Any) -> list[dict[str, Any]]:
        extracted: list[dict[str, Any]] = []
        for result in results:
            names = result.names
            for box in result.boxes:
                class_id = int(box.cls[0])
                name = str(names[class_id]).lower()
                mapped_label = self._map_label(name)
                if not mapped_label:
                    continue
                confidence = float(box.conf[0])
                extracted.append(
                    {
                        "label": mapped_label,
                        "confidence": round(confidence, 4),
                        "raw_class": name,
                        "box": box.xyxy[0].cpu().numpy().tolist(),
                    }
                )
        return extracted

    @staticmethod
    def _compute_overlap_ratio(fire_box: list[float], person_box: list[float]) -> float:
        x_left = max(fire_box[0], person_box[0])
        y_top = max(fire_box[1], person_box[1])
        x_right = min(fire_box[2], person_box[2])
        y_bottom = min(fire_box[3], person_box[3])
        
        if x_right < x_left or y_bottom < y_top:
            return 0.0
            
        intersection_area = (x_right - x_left) * (y_bottom - y_top)
        fire_area = (fire_box[2] - fire_box[0]) * (fire_box[3] - fire_box[1])
        person_area = (person_box[2] - person_box[0]) * (person_box[3] - person_box[1])
        
        if fire_area == 0 or person_area == 0:
            return 0.0
            
        return max(float(intersection_area / fire_area), float(intersection_area / person_area))

    def _fallback_detections(self, frame: np.ndarray) -> list[dict[str, Any]]:
        detections: list[dict[str, Any]] = []
        fire_confidence = self._detect_fire_heuristic(frame)
        smoke_confidence = self._detect_smoke_heuristic(frame)
        if fire_confidence is not None:
            detections.append(
                {
                    "label": "fire",
                    "confidence": fire_confidence,
                    "raw_class": "heuristic_fire",
                }
            )
        if smoke_confidence is not None:
            detections.append(
                {
                    "label": "smoke",
                    "confidence": smoke_confidence,
                    "raw_class": "heuristic_smoke",
                }
            )
        return detections

    def _detect_fire_heuristic(self, frame: np.ndarray) -> float | None:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower = np.array([5, 100, 150], dtype=np.uint8)
        upper = np.array([30, 255, 255], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper)
        mask = cv2.GaussianBlur(mask, (9, 9), 0)
        _, mask = cv2.threshold(mask, 140, 255, cv2.THRESH_BINARY)
        ratio = float(np.count_nonzero(mask)) / float(mask.size)
        # Require 1.5% of pixels to be vivid orange/warm — calibrated for demos
        if ratio < 0.015:
            return None
        confidence = min(0.90, 0.40 + ratio * 8.0)
        return round(confidence, 4)

    def _detect_smoke_heuristic(self, frame: np.ndarray) -> float | None:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        h, s, v = cv2.split(hsv)
        # Grayish: low saturation, mid-high brightness, not walls (s < 45 is tighter)
        grayish = ((s < 45) & (v > 80) & (v < 210)).astype(np.uint8) * 255
        grayish = cv2.medianBlur(grayish, 7)
        edges = cv2.Canny(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 40, 120)
        edge_ratio = float(np.count_nonzero(edges)) / float(edges.size)
        smoke_ratio = float(np.count_nonzero(grayish)) / float(grayish.size)
        # Require 8% grayish pixels AND very low edge density (smoke is diffuse, not structured)
        if smoke_ratio < 0.08 or edge_ratio > 0.08:
            return None
        confidence = min(0.82, 0.35 + smoke_ratio * 2.5)
        return round(confidence, 4)

    def _emit_detections(self, detections: list[dict[str, Any]]) -> None:
        now = time.monotonic()
        # Source-level deduplication: if another runtime is already handling this physical
        # source, don't double-emit the same detection to a different location.
        source_key = str(self.config.source).strip()
        for detection in detections:
            label = detection["label"]
            last_emit = self._last_emit_by_label.get(label, 0.0)
            if now - last_emit < self.config.emit_interval_seconds:
                continue

            # Check if another runtime owns this source and emitted more recently
            with _source_emit_lock:
                global_last = _source_last_emit.get((source_key, label), 0.0)
                if now - global_last < self.config.emit_interval_seconds * 2:
                    # Another camera on the same physical source already emitted — skip
                    continue
                _source_last_emit[(source_key, label)] = now

            payload = {
                "camera_id": self.config.camera_id,
                "location": self.config.location,
                "label": label,
                "confidence": detection["confidence"],
            }
            self._post_json(f"{self.config.backend_url}/ingest/detection", payload)
            self._last_emit_by_label[label] = now
            with self._lock:
                self.state.emitted_events += 1
                self.state.last_emit_at = self._now_iso()

    def _post_json(self, url: str, payload: dict[str, Any]) -> None:
        request_body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                body = response.read().decode("utf-8", errors="replace")
                if response.status >= 400:
                    print(f"[vision] Backend rejected detection {response.status}: {body}")
                else:
                    print(f"[vision] Detection accepted: {payload['label']} @ {payload['location']} conf={payload['confidence']}")
        except Exception as exc:
            print(f"[vision] POST failed to {url}: {exc}")

    @staticmethod
    def _map_label(name: str) -> str | None:
        if "smoke" in name:
            return "smoke"
        if "fire" in name or "flame" in name:
            return "fire"
        return None

    @staticmethod
    def _parse_source(source: str) -> Any:
        stripped = source.strip()
        if stripped.isdigit():
            return int(stripped)
        return stripped

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(UTC).isoformat()


app = Flask(__name__)
runtimes: dict[str, DetectorRuntime] = {}

def get_runtime(camera_id: str | None) -> DetectorRuntime:
    if not camera_id:
        raise ValueError("camera_id is required")
    if camera_id not in runtimes:
        runtimes[camera_id] = DetectorRuntime()
        # Initialize default config with the camera_id
        runtimes[camera_id].config.camera_id = camera_id
    return runtimes[camera_id]


@app.get("/health")
def health() -> tuple[object, int]:
    return jsonify({cam: r.snapshot() for cam, r in runtimes.items()}), 200


@app.post("/configure")
def configure() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Request body must be a JSON object."}), 400
    try:
        camera_id = payload.get("camera_id")
        runtime = get_runtime(camera_id)
        runtime.configure(payload)
    except (ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, **runtime.snapshot()}), 200


@app.post("/start")
def start() -> tuple[object, int]:
    payload = request.get_json(silent=True) or {}
    try:
        camera_id = payload.get("camera_id")
        runtime = get_runtime(camera_id)
        runtime.start()
    except (ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, **runtime.snapshot()}), 200


@app.post("/stop")
def stop() -> tuple[object, int]:
    payload = request.get_json(silent=True) or {}
    try:
        camera_id = payload.get("camera_id")
        if camera_id in runtimes:
            runtime = runtimes[camera_id]
            runtime.stop()
            return jsonify({"ok": True, **runtime.snapshot()}), 200
        return jsonify({"ok": False, "error": "camera_id not found"}), 404
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.post("/detect-once")
def detect_once() -> tuple[object, int]:
    payload = request.get_json(silent=True) or {}
    try:
        camera_id = payload.get("camera_id")
        runtime = get_runtime(camera_id)
        detections = runtime.detect_once()
    except (ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "detections": detections, **runtime.snapshot()}), 200


@app.get("/stream")
def stream_video() -> Response:
    camera_id = request.args.get("camera_id")
    if not camera_id or camera_id not in runtimes:
        return Response("camera_id not found or not provided", status=404)
        
    runtime = runtimes[camera_id]
    
    def generate():
        last_bytes = None
        while True:
            with runtime._lock:
                frame_bytes = runtime._latest_frame_jpg
            if frame_bytes and frame_bytes != last_bytes:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                last_bytes = frame_bytes
            time.sleep(0.05)
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')


@app.get("/frame")
def get_frame() -> Response:
    camera_id = request.args.get("camera_id")
    if not camera_id or camera_id not in runtimes:
        return Response("camera_id not found", status=404)
    runtime = runtimes[camera_id]
    with runtime._lock:
        frame_bytes = runtime._latest_frame_jpg
    if not frame_bytes:
        return Response("No frame available", status=404)
    return Response(frame_bytes, mimetype='image/jpeg')


# ── Option A: browser-side frame analysis ────────────────────────────────────
# A single shared YOLO model (loaded lazily) for /analyze-frame requests.
# Protected by a lock so concurrent camera requests don't race.
_af_lock = threading.Lock()
_af_model: Any = None
_af_model_path: str | None = None


def _load_af_model(model_path: str) -> Any:
    """Load (or return cached) YOLO model for analyze-frame requests."""
    global _af_model, _af_model_path
    if _af_model is None or _af_model_path != model_path:
        if YOLO is None:
            return None
        try:
            _af_model = YOLO(model_path)
            _af_model_path = model_path
        except Exception as exc:
            print(f"[vision] Could not load model '{model_path}': {exc}")
            _af_model = None
    return _af_model


def _analyze_single_frame(
    frame: Any,
    model_path: str = "vision/models/best.pt",
    confidence: float = 0.45,
    enable_heuristics: bool = True,
) -> list[dict[str, Any]]:
    """Run YOLO + optional heuristic fallback on one frame. Returns detection list."""
    detections: list[dict[str, Any]] = []

    model = _load_af_model(model_path)
    if model is not None:
        results = model(frame, conf=confidence, verbose=False)
        for result in results:
            names = result.names
            for box in result.boxes:
                class_id = int(box.cls[0])
                name = str(names[class_id]).lower()
                label = DetectorRuntime._map_label(name)
                if label:
                    detections.append({
                        "label": label,
                        "confidence": round(float(box.conf[0]), 4),
                    })

    # Heuristic fallback when YOLO finds nothing (or isn't available)
    if not detections and enable_heuristics:
        _rt = DetectorRuntime()
        detections = _rt._fallback_detections(frame)

    return detections


@app.post("/analyze-frame")
def analyze_frame() -> tuple[object, int]:
    """
    Option A endpoint: browser POSTs a JPEG frame, receives detection results.
    Query params:
      camera_id   — identifies the camera (for logging)
      location    — zone name (for logging)
      confidence  — YOLO confidence threshold (default 0.45)
      model_path  — path to YOLO model (default vision/models/best.pt)
    Body: raw JPEG bytes (Content-Type: image/jpeg)
    Response: { ok, detections: [{ label, confidence }] }
    """
    if cv2 is None:
        return jsonify({"ok": False, "error": "cv2 not available", "detections": []}), 503

    jpg_data = request.get_data()
    if not jpg_data:
        return jsonify({"ok": False, "error": "No image data in request body", "detections": []}), 400

    try:
        nparr = np.frombuffer(jpg_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Image decode failed: {exc}", "detections": []}), 400

    if frame is None:
        return jsonify({"ok": False, "error": "cv2 could not decode image", "detections": []}), 400

    try:
        confidence = float(request.args.get("confidence", "0.45"))
    except ValueError:
        confidence = 0.45

    model_path = request.args.get("model_path", "vision/models/best.pt")

    with _af_lock:
        detections = _analyze_single_frame(frame, model_path, confidence)

    camera_id = request.args.get("camera_id", "unknown")
    location  = request.args.get("location", "unknown")
    
    # Debug logging for heuristics
    _rt = DetectorRuntime()
    h_fire = _rt._detect_fire_heuristic(frame)
    h_smoke = _rt._detect_smoke_heuristic(frame)
    
    if detections:
        labels = ", ".join(f"{d['label']}@{d['confidence']}" for d in detections)
        print(f"[analyze-frame] {camera_id} ({location}): DETECTED {labels}")
    else:
        # Log ratios to help user calibrate
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        fire_mask = cv2.inRange(hsv, np.array([5, 100, 150]), np.array([30, 255, 255]))
        fire_ratio = float(np.count_nonzero(fire_mask)) / float(fire_mask.size)
        print(f"[analyze-frame] {camera_id} ({location}): No detection. (Fire ratio: {fire_ratio:.4f}, Smoke: {h_smoke or 0})")

    return jsonify({"ok": True, "detections": detections}), 200


@app.get("/media")
def serve_media() -> Response:
    """
    Serve any local file (MP4, etc.) through the visionapi proxy.
    Supports HTTP Range requests so browsers can seek within videos.

    Usage:  /visionapi/media?path=C:\\Users\\...\\video.mp4
    """
    path = request.args.get("path", "").strip()
    if not path:
        return Response("path parameter required", status=400)

    abs_path = os.path.abspath(path)
    if not os.path.isfile(abs_path):
        return Response(f"File not found: {abs_path}", status=404)

    file_size = os.path.getsize(abs_path)
    mime, _ = mimetypes.guess_type(abs_path)
    mime = mime or "application/octet-stream"

    range_header = request.headers.get("Range", "")

    if range_header and range_header.startswith("bytes="):
        # Parse "bytes=start-end"
        byte_range = range_header[6:].split("-")
        try:
            start = int(byte_range[0])
            end   = int(byte_range[1]) if byte_range[1] else file_size - 1
        except (IndexError, ValueError):
            return Response("Invalid Range header", status=416)

        end    = min(end, file_size - 1)
        length = end - start + 1

        def _gen_range() -> Any:
            with open(abs_path, "rb") as fh:
                fh.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = fh.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        headers = {
            "Content-Range":  f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges":  "bytes",
            "Content-Length": str(length),
        }
        return Response(_gen_range(), status=206, mimetype=mime, headers=headers)

    # Full file (no Range header)
    def _gen_full() -> Any:
        with open(abs_path, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                yield chunk

    headers = {
        "Accept-Ranges":  "bytes",
        "Content-Length": str(file_size),
    }
    return Response(_gen_full(), status=200, mimetype=mime, headers=headers)


@app.get("/media/list")
def list_media() -> Response:
    """
    List files in the frontend/demo directory or a custom path.
    Returns a list of relative or absolute paths.
    """
    path = request.args.get("path", "frontend/demo").strip()
    abs_path = os.path.abspath(path)
    
    if not os.path.isdir(abs_path):
        return jsonify({"ok": False, "error": f"Directory not found: {abs_path}"}), 404
        
    files = []
    try:
        for f in os.listdir(abs_path):
            if f.lower().endswith((".mp4", ".mov", ".avi", ".mkv", ".webm")):
                full_f = os.path.join(abs_path, f)
                # If the path is inside frontend/, return a path relative to frontend/
                # e.g. "frontend/demo/v.mp4" -> "demo/v.mp4"
                rel_to_root = os.path.relpath(full_f, "frontend").replace("\\", "/") if not os.path.isabs(path) else None
                
                files.append({
                    "name": f,
                    "path": rel_to_root if rel_to_root else full_f,
                    "size": os.path.getsize(full_f)
                })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
        
    return jsonify({"ok": True, "files": files}), 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=VISION_PORT, debug=True, threaded=True)

