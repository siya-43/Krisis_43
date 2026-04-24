import os
from pathlib import Path
from flask import Flask, jsonify, request

# Load environment variables from .env if present
def _load_env():
    root_dir = Path(__file__).resolve().parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    # Clean up key and value (strip spaces and quotes)
                    k = k.strip()
                    v = v.strip().strip("'").strip('"')
                    os.environ[k] = v
                    if "TWILIO" in k:
                        print(f"[config] Loaded {k}")

_load_env()

from app.engine import IncidentEngine
from app.models import DetectionEvent, ManualEvent, SensorEvent, StaffContact

app = Flask(__name__)
engine = IncidentEngine()


@app.get("/health")
def health() -> tuple[dict[str, str], int]:
    return {"status": "ok"}, 200


@app.post("/ingest/detection")
def ingest_detection() -> tuple[dict[str, object], int]:
    return _handle_event(DetectionEvent.from_dict, engine.add_detection)


@app.post("/ingest/sensor")
def ingest_sensor() -> tuple[dict[str, object], int]:
    return _handle_event(SensorEvent.from_dict, engine.add_sensor)


@app.post("/ingest/manual")
def ingest_manual() -> tuple[dict[str, object], int]:
    return _handle_event(ManualEvent.from_dict, engine.add_manual, manual=True)


@app.post("/ingest/broadcast")
def ingest_broadcast() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    message = payload.get("message") if isinstance(payload, dict) else None
    if not message:
        return jsonify({"accepted": False, "error": "missing_message"}), 400
        
    incident = engine.add_broadcast(message)
    return jsonify({"accepted": True, "incident": incident.to_dict()}), 200


@app.get("/incidents/active")
def active_incidents() -> tuple[object, int]:
    return jsonify([incident.to_dict() for incident in engine.get_active_incidents()]), 200


@app.post("/incidents/<location>/resolve")
def resolve_incident(location: str) -> tuple[object, int]:
    # We unescape the location name from the URL
    from urllib.parse import unquote
    loc = unquote(location)
    ok = engine.resolve_incident(loc)
    return jsonify({"ok": ok}), 200 if ok else 404


@app.get("/events")
def recent_events() -> tuple[object, int]:
    return jsonify([event.to_dict() for event in engine.get_recent_events()]), 200


@app.get("/directory")
def directory() -> tuple[object, int]:
    return jsonify([contact.to_dict() for contact in engine.get_staff_directory()]), 200


@app.post("/directory")
def update_directory() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, list):
        return jsonify({"accepted": False, "error": "invalid_json"}), 400
    
    try:
        contacts = [StaffContact.from_dict(item) for item in payload]
    except Exception as exc:
        return jsonify({"accepted": False, "error": "validation_error", "detail": str(exc)}), 400
        
    engine.update_staff_directory(contacts)
    return jsonify({"accepted": True, "directory": [contact.to_dict() for contact in contacts]}), 200


@app.post("/manual-sms")
def manual_sms() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or "phone" not in payload or "message" not in payload:
        return jsonify({"accepted": False, "error": "invalid_json", "detail": "Missing phone or message"}), 400
    
    engine.send_manual_sms(payload["phone"], payload["message"])
    return jsonify({"accepted": True, "status": "sent"}), 200


@app.post("/sms/real")
def send_real_sms() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or "phone" not in payload:
        return jsonify({"sent": False, "error": "missing_phone"}), 400
        
    engine.send_real_sms_direct(payload["phone"], payload.get("message"))
    return jsonify({"sent": True}), 200


@app.post("/sms/bulk-real")
def send_bulk_real_sms() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or "phones" not in payload:
        return jsonify({"sent": False, "error": "missing_phones"}), 400
        
    message = payload.get("message", "CRITICAL ALERT: Emergency detected. Please check dashboard.")
    for phone in payload["phones"]:
        engine.send_real_sms_direct(phone, message)
    return jsonify({"sent": True, "count": len(payload["phones"])}), 200


@app.post("/twilio/receive")
def twilio_receive() -> tuple[str, int]:
    """
    Handle incoming WhatsApp/SMS from Twilio.
    If message contains 'ACK', find the most recent notification for this phone and acknowledge it.
    """
    # Twilio sends data as form-urlencoded
    data = request.form
    from_phone = data.get("From", "")
    body = data.get("Body", "").strip().upper()
    
    print(f"[twilio] Received message from {from_phone}: {body}")
    
    if "ACK" in body:
        # Normalize phone (remove 'whatsapp:' prefix)
        clean_phone = from_phone.replace("whatsapp:", "").replace("+", "")
        # Find notification
        for n in reversed(engine.get_notifications()):
            n_phone = n.recipient.phone.replace("+", "")
            if n_phone in clean_phone and n.status != "acknowledged":
                engine.acknowledge_notification(n.notification_id)
                print(f"[twilio] Auto-acknowledged {n.notification_id} via WhatsApp reply")
                break
                
    # Return empty TwiML response
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200


@app.get("/notifications")
def notifications() -> tuple[object, int]:
    return jsonify([notification.to_dict() for notification in engine.get_notifications()]), 200


@app.post("/notifications/<notification_id>/acknowledge")
def acknowledge_notification(notification_id: str) -> tuple[object, int]:
    try:
        notification = engine.acknowledge_notification(notification_id)
    except KeyError:
        return jsonify({"ok": False, "error": "notification_not_found"}), 404
    return jsonify({"ok": True, "notification": notification.to_dict()}), 200


def _handle_event(factory, handler, manual: bool = False) -> tuple[dict[str, object], int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return {
            "accepted": False,
            "error": "invalid_json",
            "detail": "Request body must be a JSON object.",
        }, 400

    try:
        event = factory(payload)
    except ValueError as exc:
        return {
            "accepted": False,
            "error": "validation_error",
            "detail": str(exc),
        }, 400

    incident = handler(event)
    return {
        "accepted": True,
        "incident_created_or_updated": True if manual else incident is not None,
        "incident": incident.to_dict() if incident else None,
    }, 200


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True, threaded=True)
