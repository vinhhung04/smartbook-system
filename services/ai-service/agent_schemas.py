from __future__ import annotations

from pydantic import BaseModel


class UserContext(BaseModel):
    user_id: str | None = None
    username: str | None = None
    email: str | None = None
    roles: list[str] = []
    permissions: list[str] = []
    is_superuser: bool = False


class PendingAction(BaseModel):
    id: str
    type: str
    status: str
    summary: str
    payload: dict
    risk: str
    requires_confirmation: bool
    allowed_roles: list[str]
    allowed_permissions: list[str]
    sources: list[dict] = []
    intent: str | None = None
    created_from_message: str
    created_at: str
    expires_at: str
    created_by_user_id: str | None = None
    created_by_roles: list[str] = []
    warnings: list[str] = []
    requires_review: bool = False


class ConfirmActionRequest(BaseModel):
    action_id: str
    confirm: bool = True
    override_payload: dict | None = None


class CancelActionRequest(BaseModel):
    action_id: str


class ConfirmActionResponse(BaseModel):
    success: bool
    action_id: str
    status: str
    message: str
    result: dict | None = None
