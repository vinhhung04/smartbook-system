"""Pydantic contracts: what the model must return (parsed leniently per
observation, strictly at the top level) and what the API returns.

Statuses are rule outcomes, never model self-assessments:
- EXTRACTED        one image shows a grounded, well-formed value
- CORROBORATED     two independent sources agree (two images, image+barcode,
                   or image+ISBN lookup)
- CONFLICTED       sources disagree; no value is proposed
- MISSING          nothing observed
- INVALID          observed, but every reading failed validation
                   (checksum, range, ungrounded, wrong role)
- REVIEW_REQUIRED  a value exists but something needs a human look
- INFERRED         derived by a rule, not read (language only)
- LOOKUP_ONLY      not in the images; offered from the ISBN lookup
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# v2: the answer template shows filled observation objects - with only empty
# arrays, qwen3.7-flash answered bare strings (no source, no evidence).
PROMPT_VERSION = "book-ocr-v2"
SCHEMA_VERSION = "book-ocr-scan-v1"

FieldStatus = Literal["EXTRACTED", "CORROBORATED", "CONFLICTED", "MISSING", "INVALID",
                      "REVIEW_REQUIRED", "INFERRED", "LOOKUP_ONLY"]

# The model's per-field observation lists. Order is the response order.
OCR_FIELDS = ("title", "subtitle", "authors", "translators", "publisher", "distributor", "isbn",
              "publicationYear", "printYear", "copyrightYear", "editionStatement", "pageCount",
              "coverPrice", "description")


class ModelObservation(BaseModel):
    """One reading of one field in one image, as the model reports it."""
    model_config = ConfigDict(extra="ignore")
    source: str = Field(min_length=1, max_length=40)
    value: str | int | list[str] | None = None
    observedText: str | None = Field(default=None, max_length=6000)


class ModelOtherCode(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=120)
    observedText: str | None = Field(default=None, max_length=300)


class ModelImageNote(BaseModel):
    model_config = ConfigDict(extra="ignore")
    source: str = Field(min_length=1, max_length=40)
    legible: bool = True
    issue: str | None = Field(default=None, max_length=300)


class Observation(BaseModel):
    source: str
    value: Any
    normalizedValue: Any = None
    observedText: str | None = None
    valid: bool
    issues: list[str] = Field(default_factory=list)


class FieldResult(BaseModel):
    field: str
    status: FieldStatus
    value: Any = None
    sources: list[str] = Field(default_factory=list)
    observations: list[Observation] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)


class ProposalOption(BaseModel):
    source: str
    value: str


class Proposal(BaseModel):
    """One EditableBookForm field. `value` is form-ready text (lists joined
    with ", "); it is null whenever the sources disagree."""
    formField: str
    value: str | None = None
    status: FieldStatus
    source: Literal["images", "isbn_lookup", "images+isbn_lookup", "barcode", "rule"] | None = None
    safeToApply: bool = False
    reasons: list[str] = Field(default_factory=list)
    ocrValue: str | None = None
    lookupValue: str | None = None
    options: list[ProposalOption] = Field(default_factory=list)


class UsageCall(BaseModel):
    model: str
    trigger: str
    status: str
    latencyMs: int
    promptTokens: int | None = None
    completionTokens: int | None = None
    costUsd: float | None = None
    error: str | None = None


class ScanUsage(BaseModel):
    model: str | None = None
    fallbackUsed: bool = False
    cacheHit: bool = False
    imageCount: int = 0
    promptTokens: int = 0
    completionTokens: int = 0
    costUsd: float | None = None
    latencyMs: int = 0
    calls: list[UsageCall] = Field(default_factory=list)


class IsbnLookupOutcome(BaseModel):
    status: Literal["FOUND", "NOT_FOUND", "SKIPPED_NO_VALID_ISBN", "SKIPPED_ISBN_CONFLICT",
                    "TIMEOUT", "ERROR", "DISABLED"]
    isbn: str | None = None
    editionMatches: bool | None = None
    lookup: dict | None = None


class ScanResponse(BaseModel):
    schemaVersion: str = SCHEMA_VERSION
    promptVersion: str = PROMPT_VERSION
    status: Literal["SUCCESS", "PARTIAL", "NO_DATA"]
    images: list[dict]
    metadata: dict
    fields: dict[str, FieldResult]
    fieldEvidence: dict[str, list[dict]]
    missingFields: list[str]
    conflictedFields: list[str]
    otherCodes: list[dict]
    warnings: list[str]
    isbnLookup: IsbnLookupOutcome
    proposals: dict[str, Proposal]
    usage: ScanUsage
    processingTimeMs: int
