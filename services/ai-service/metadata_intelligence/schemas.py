from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

VERSION = 'metadata-intelligence-v2.1'
FIELDS = ('title', 'subtitle', 'authors', 'translator', 'publisher', 'publishedDate',
          'isbn', 'pageCount', 'categories', 'description', 'language', 'thumbnail')
LIST_FIELDS = {'authors', 'translator', 'categories'}
# Fields that describe the work rather than a specific printing/ISBN, so a
# record whose ISBN does not match the target edition can still corroborate them.
WORK_SCOPE_FIELDS = {'description'}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ExtractionInput(StrictModel):
    type: Literal['isbn', 'html', 'text']
    value: str = Field(min_length=1, max_length=100_000)
    sourceUrl: str | None = Field(default=None, max_length=2048)
    targetIsbn: str | None = Field(default=None, max_length=32)


class ExtractionRequest(StrictModel):
    input: ExtractionInput


class MetadataCandidate(StrictModel):
    id: str
    sourceDocumentId: str
    sourceRecordId: str
    field: str
    rawValue: Any
    normalizedValue: Any
    origin: Literal['SOURCE_DIRECT', 'RULE_EXTRACTED', 'LLM_EXTRACTED']
    extractorVersion: str = VERSION
    model: str | None = None
    promptVersion: str | None = None
    evidenceIds: list[str] = Field(default_factory=list)
    scope: Literal['edition', 'work'] = 'edition'
    editionStatus: str = 'unverified'
    observedIsbns: list[str] = Field(default_factory=list)
    normalizationSteps: list[dict] = Field(default_factory=list)
    eligibleForFusion: bool = True
    rejectionReasons: list[str] = Field(default_factory=list)


class ExtractionEvidence(StrictModel):
    id: str
    sourceDocumentId: str
    sourceRecordId: str
    snapshotHash: str
    kind: Literal['JSON_POINTER', 'TEXT_SPAN']
    jsonPointer: str | None = None
    rawJsonValue: Any = None
    blockId: str | None = None
    start: int | None = None
    end: int | None = None
    quote: str | None = None
    itemIndex: int | None = None
    locatorValid: bool = False
    supportValidation: dict = Field(default_factory=dict)


class FieldDecision(StrictModel):
    field: str
    proposedValue: Any = None
    selectedCandidateIds: list[str] = Field(default_factory=list)
    alternativeCandidateIds: list[str] = Field(default_factory=list)
    excludedCandidates: list[dict] = Field(default_factory=list)
    confidenceComponents: dict = Field(default_factory=dict)
    confidence: float = 0
    confidenceKind: str = 'heuristic'
    reasonCodes: list[str] = Field(default_factory=list)
    status: str = 'MISSING'
    agreementGroups: int = 0
    conflictGroups: int = 0
    finalValue: Any = None
    reviewedBy: str | None = None
    reviewedAt: str | None = None


class FieldProvenance(StrictModel):
    field: str
    sourceDocumentIds: list[str]
    candidateIds: list[str]
    evidenceIds: list[str]
    events: list[dict]
