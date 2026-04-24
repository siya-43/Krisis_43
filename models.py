from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal
import uuid


DetectionLabel = Literal["fire", "smoke", "abnormal_motion", "crowd_panic"]
SensorType = Literal["temperature", "gas", "sound"]
ManualTriggerType = Literal["panic_button", "security_override", "medical_button", "fire_sos", "medical_sos", "security_sos"]
IncidentType = Literal["fire", "security", "medical", "warning", "broadcast"]
Severity = Literal["low", "medium", "high", "critical"]
Channel = Literal["sms", "voice", "dashboard", "whatsapp"]
NotificationStatus = Literal["sent", "acknowledged", "escalated"]

DETECTION_LABELS = {"fire", "smoke", "abnormal_motion", "crowd_panic"}
SENSOR_TYPES = {"temperature", "gas", "sound"}
MANUAL_TRIGGER_TYPES = {"panic_button", "security_override", "medical_button", "fire_sos", "medical_sos", "security_sos"}


def parse_timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    raise ValueError("timestamp must be an ISO 8601 string")


def require_string(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value.strip()


def require_float(payload: dict[str, Any], field: str) -> float:
    value = payload.get(field)
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a number") from exc


@dataclass(slots=True)
class DetectionEvent:
    camera_id: str
    location: str
    label: DetectionLabel
    confidence: float
    timestamp: datetime | None = None

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "DetectionEvent":
        label = require_string(payload, "label")
        if label not in DETECTION_LABELS:
            raise ValueError(f"label must be one of {sorted(DETECTION_LABELS)}")

        confidence = require_float(payload, "confidence")
        if confidence < 0.0 or confidence > 1.0:
            raise ValueError("confidence must be between 0 and 1")

        return cls(
            camera_id=require_string(payload, "camera_id"),
            location=require_string(payload, "location"),
            label=label,
            confidence=confidence,
            timestamp=parse_timestamp(payload.get("timestamp")),
        )

    def with_updates(self, **updates: Any) -> "DetectionEvent":
        return replace(self, **updates)

    def to_dict(self) -> dict[str, Any]:
        return _serialize(asdict(self))


@dataclass(slots=True)
class SensorEvent:
    sensor_id: str
    location: str
    sensor_type: SensorType
    value: float
    timestamp: datetime | None = None

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SensorEvent":
        sensor_type = require_string(payload, "sensor_type")
        if sensor_type not in SENSOR_TYPES:
            raise ValueError(f"sensor_type must be one of {sorted(SENSOR_TYPES)}")

        return cls(
            sensor_id=require_string(payload, "sensor_id"),
            location=require_string(payload, "location"),
            sensor_type=sensor_type,
            value=require_float(payload, "value"),
            timestamp=parse_timestamp(payload.get("timestamp")),
        )

    def with_updates(self, **updates: Any) -> "SensorEvent":
        return replace(self, **updates)

    def to_dict(self) -> dict[str, Any]:
        return _serialize(asdict(self))


@dataclass(slots=True)
class ManualEvent:
    trigger_id: str
    location: str
    trigger_type: ManualTriggerType
    source: str = "manual"
    notes: str | None = None
    timestamp: datetime | None = None

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "ManualEvent":
        trigger_type = require_string(payload, "trigger_type")
        if trigger_type not in MANUAL_TRIGGER_TYPES:
            raise ValueError(f"trigger_type must be one of {sorted(MANUAL_TRIGGER_TYPES)}")

        notes = payload.get("notes")
        if notes is not None and not isinstance(notes, str):
            raise ValueError("notes must be a string")

        return cls(
            trigger_id=require_string(payload, "trigger_id"),
            location=require_string(payload, "location"),
            trigger_type=trigger_type,
            source=payload.get("source", "manual"),
            notes=notes,
            timestamp=parse_timestamp(payload.get("timestamp")),
        )

    def with_updates(self, **updates: Any) -> "ManualEvent":
        return replace(self, **updates)

    def to_dict(self) -> dict[str, Any]:
        return _serialize(asdict(self))


@dataclass(slots=True)
class Incident:
    incident_id: str
    type: IncidentType
    severity: Severity
    location: str
    summary: str
    recommended_action: str
    first_seen: datetime
    last_updated: datetime
    evidence: list[str]
    status: Literal["active", "resolved"] = "active"
    source: Literal["ai", "manual"] = "ai"

    def with_updates(self, **updates: Any) -> "Incident":
        return replace(self, **updates)

    def to_dict(self) -> dict[str, Any]:
        return _serialize(asdict(self))


@dataclass(slots=True)
class EventEnvelope:
    kind: Literal["detection", "sensor", "manual"]
    payload: DetectionEvent | SensorEvent | ManualEvent
    received_at: datetime

    def to_dict(self) -> dict[str, Any]:
        payload_data = self.payload
        if hasattr(payload_data, "to_dict"):
            payload_data = payload_data.to_dict()
            
        timestamp = self.received_at
        if hasattr(timestamp, "isoformat"):
            timestamp = timestamp.isoformat()
            
        return {
            "kind": self.kind,
            "payload": payload_data,
            "received_at": timestamp,
        }


@dataclass(slots=True)
class StaffContact:
    contact_id: str
    name: str
    role: str
    zone: str
    phone: str
    channels: list[Channel]
    escalation_level: int
    current_zone: str | None = None
    last_seen: str | None = None
    on_shift: bool = True

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "StaffContact":
        channels = payload.get("channels", [])
        if isinstance(channels, str):
            channels = [c.strip() for c in channels.split(",") if c.strip()]
        
        return cls(
            contact_id=payload.get("contact_id") or str(uuid.uuid4())[:8],
            name=require_string(payload, "name"),
            role=require_string(payload, "role"),
            zone=require_string(payload, "zone"),
            phone=require_string(payload, "phone"),
            channels=channels,
            escalation_level=int(payload.get("escalation_level", 1)),
            on_shift=payload.get("on_shift", True)
        )

    def to_dict(self) -> dict[str, Any]:
        return _serialize(asdict(self))


@dataclass(slots=True)
class Notification:
    notification_id: str
    incident_id: str
    location: str
    incident_type: IncidentType
    severity: Severity
    recipient: StaffContact
    channel: Channel
    message: str
    status: NotificationStatus
    created_at: datetime
    updated_at: datetime
    acknowledged_at: datetime | None = None
    reason: str | None = None

    def with_updates(self, **updates: Any) -> "Notification":
        return replace(self, **updates)

    def to_dict(self) -> dict[str, Any]:
        return {
            "notification_id": self.notification_id,
            "incident_id": self.incident_id,
            "location": self.location,
            "incident_type": self.incident_type,
            "severity": self.severity,
            "recipient": self.recipient.to_dict(),
            "channel": self.channel,
            "message": self.message,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            "reason": self.reason,
        }


def _serialize(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    return value
