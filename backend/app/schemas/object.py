"""Request and response bodies. Text from users is cleaned here, at the trust boundary."""

import math
import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value: str) -> str:
    """Drops control characters and outer whitespace.

    The frontend renders every user string as text, never as HTML, so markup stays inert;
    this keeps stored values printable and free of terminal escape codes.
    """
    return _CONTROL.sub("", value).strip()


def _finite_vec3(value: list[float]) -> list[float]:
    if len(value) != 3 or not all(math.isfinite(v) for v in value):
        raise ValueError("must be three finite numbers")
    return [float(v) for v in value]


def _tags(value: list[str]) -> list[str]:
    seen: list[str] = []
    for tag in value:
        tag = clean_text(tag).lower()[:32]
        if tag and tag not in seen:
            seen.append(tag)
    return seen[:12]


def _not_blank(value: str) -> str:
    if not value:
        raise ValueError("must not be empty")
    return value


Vec3 = Annotated[list[float], AfterValidator(_finite_vec3)]
CleanStr = Annotated[str, AfterValidator(clean_text)]
# Field(min_length) runs before cleaning, so emptiness is checked again after it.
RequiredStr = Annotated[str, AfterValidator(clean_text), AfterValidator(_not_blank)]
Tags = Annotated[list[str], AfterValidator(_tags)]


# Rights statements a curator can choose. Open licences allow visitors to download the model.
LICENSES: dict[str, str] = {
    "cc0": "CC0 1.0 (public domain)",
    "cc-by": "CC BY 4.0",
    "cc-by-sa": "CC BY-SA 4.0",
    "cc-by-nc": "CC BY-NC 4.0",
    "cc-by-nc-nd": "CC BY-NC-ND 4.0",
    "all-rights-reserved": "All rights reserved",
}
OPEN_LICENSES = frozenset(LICENSES) - {"all-rights-reserved"}
License = Literal["cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-nd", "all-rights-reserved"]

# What a note records. Damage notes may carry a severity, on the scale condition reports use.
NoteCategory = Literal["note", "detail", "inscription", "damage", "repair"]
Severity = Literal["negligible", "slight", "moderate", "marked", "extreme"]


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:  # SQLite returns naive datetimes; they were stored as UTC.
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class UserOut(BaseModel):
    id: int
    login: str
    display_name: str
    role: str


class LoginIn(BaseModel):
    login: RequiredStr = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=200)


class ObjectRecord(BaseModel):
    """The museum record of an object. Every field is optional free text; empty fields are dropped."""

    model_config = ConfigDict(extra="forbid")

    accession_number: CleanStr | None = Field(default=None, max_length=64)
    maker: CleanStr | None = Field(default=None, max_length=200)
    date: CleanStr | None = Field(default=None, max_length=100)
    place: CleanStr | None = Field(default=None, max_length=200)
    material: CleanStr | None = Field(default=None, max_length=200)
    credit_line: CleanStr | None = Field(default=None, max_length=300)
    provenance: CleanStr | None = Field(default=None, max_length=2000)


def stored_record(record: dict | None) -> dict[str, str] | None:
    """The fields worth storing: empty values are left out, and an empty record is None."""
    kept = {key: value for key, value in (record or {}).items() if value}
    return kept or None


class ObjectOut(BaseModel):
    id: int
    title: str
    description: str
    tags: list[str]
    record: dict[str, str]
    license: str | None
    downloadable: bool
    alt_text: str | None
    visits: int
    status: str
    model_url: str | None
    model_format: str
    up: list[float] | None
    dimensions_mm: list[float] | None
    triangles: int | None
    file_size: int | None
    thumbnail_url: str | None
    is_demo: bool
    job_id: int | None
    annotation_count: int
    created_at: str
    updated_at: str


class ObjectPage(BaseModel):
    items: list[ObjectOut]
    total: int
    page: int
    page_size: int


class ObjectPatch(BaseModel):
    title: RequiredStr | None = Field(default=None, min_length=1, max_length=120)
    description: CleanStr | None = Field(default=None, max_length=4000)
    tags: Tags | None = None
    up: Vec3 | None = None
    dimensions_mm: Vec3 | None = None
    # For these, null clears the value.
    record: ObjectRecord | None = None
    license: License | None = None
    alt_text: CleanStr | None = Field(default=None, max_length=1000)


class TagCount(BaseModel):
    tag: str
    count: int


class AnnotationIn(BaseModel):
    position: Vec3
    normal: Vec3
    title: RequiredStr = Field(min_length=1, max_length=80)
    text: CleanStr = Field(default="", max_length=2000)
    category: NoteCategory = "note"
    severity: Severity | None = None

    @model_validator(mode="after")
    def _severity_only_for_damage(self) -> "AnnotationIn":
        if self.category != "damage":
            self.severity = None
        return self


class AnnotationPatch(BaseModel):
    position: Vec3 | None = None
    normal: Vec3 | None = None
    title: RequiredStr | None = Field(default=None, min_length=1, max_length=80)
    text: CleanStr | None = Field(default=None, max_length=2000)
    category: NoteCategory | None = None
    severity: Severity | None = None  # null clears it


class AnnotationOut(BaseModel):
    id: int
    object_id: int
    position: list[float]
    normal: list[float]
    title: str
    text: str
    category: str
    severity: str | None
    author: str | None
    created_at: str
    updated_at: str


class ViewState(BaseModel):
    """Everything a shared link restores. Small and closed, so it cannot carry other data."""

    position: Vec3
    target: Vec3
    environment: Literal["studio", "room", "outdoor", "none"] | None = None
    exposure: float | None = Field(default=None, ge=0, le=4)
    light_intensity: float | None = Field(default=None, ge=0, le=10)
    light_direction: Vec3 | None = None
    background: bool | None = None


class ViewOut(BaseModel):
    id: str
    object_id: int
    state: ViewState
    created_at: str


class JobOut(BaseModel):
    id: int
    object_id: int
    object_title: str
    status: str
    stage: str | None
    progress: int
    pipeline: str | None
    photo_count: int
    stage_times: dict[str, float]
    error: str | None
    attempts: int
    created_at: str
    started_at: str | None
    finished_at: str | None
    log: str | None = None


class StageOut(BaseModel):
    key: str
    label: str
    description: str


class PipelineInfo(BaseModel):
    mode: str
    reason: str
    stages: list[StageOut]
    limits: dict[str, int]


class DayCount(BaseModel):
    date: str
    done: int
    failed: int


class TopObject(BaseModel):
    id: int
    title: str
    visits: int
    thumbnail_url: str | None


class Stats(BaseModel):
    """The curator dashboard: the collection, the work behind it and how visitors use it."""

    objects: dict[str, int]
    notes: int
    notes_by_category: dict[str, int]
    shared_views: int
    visits: int
    storage_bytes: dict[str, int]
    jobs: dict[str, int]
    median_job_seconds: float | None
    stage_seconds: dict[str, float]
    jobs_by_day: list[DayCount]
    top_objects: list[TopObject]
    recent_jobs: list[JobOut]
