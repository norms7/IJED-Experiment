"""
Notifications endpoints

GET  /notifications/stream          – SSE stream (keep-alive, real-time push)
GET  /notifications                 – list notifications (paginated, newest first)
PATCH /notifications/{id}/read      – mark one notification read
PATCH /notifications/read-all       – mark all as read
DELETE /notifications/{id}          – delete one notification
POST /notifications/announce        – admin: broadcast announcement to role/all

POST /notifications/internal/module-uploaded    – called internally after module create
POST /notifications/internal/activity-created   – called internally after activity create
POST /notifications/internal/activity-graded    – called internally after grading
POST /notifications/internal/submission-received – called internally after student submits
"""
import asyncio
import json
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from sqlalchemy import select, update, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db
from app.models.models import Notification, User
from app.services.notification_service import (
    NotificationService, register_connection, unregister_connection
)

notif_router = APIRouter(prefix="/notifications", tags=["Notifications"])
_notif_bearer = HTTPBearer(auto_error=False)


# ── Auth helper ───────────────────────────────────────────────────────────────

_notif_bearer = HTTPBearer(auto_error=False)

async def get_current_user_payload(
    credentials=Depends(_notif_bearer),
    token: Optional[str] = Query(None),
) -> dict:
    raw = (credentials.credentials if credentials else None) or token
    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_token(raw)


# ── SSE stream ────────────────────────────────────────────────────────────────

@notif_router.get("/stream", summary="SSE stream for real-time notifications")
async def notification_stream(
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    credentials=Depends(_notif_bearer),
):
    # Accept token from either Authorization header or ?token= query param
    raw_token = token or (credentials.credentials if credentials else None)
    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing token")
    payload = decode_token(raw_token)
    user_id = int(payload["sub"])
    q = register_connection(user_id)

    async def event_generator():
        # Send unread count immediately on connect
        count_result = await db.execute(
            select(func.count(Notification.id))
            .where(Notification.target_user_id == user_id, Notification.is_read == False)
        )
        unread = count_result.scalar() or 0
        yield f"data: {json.dumps({'type': 'connected', 'unread_count': unread})}\n\n"

        try:
            while True:
                try:
                    # Wait up to 25s then send a keepalive comment
                    item = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(item)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            unregister_connection(user_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # Nginx: disable proxy buffering
        },
    )


# ── List notifications ────────────────────────────────────────────────────────

@notif_router.get("", summary="Get my notifications")
async def list_notifications(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    unread_only: bool = Query(False),
    payload: dict = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    user_id = int(payload["sub"])
    q = (
        select(Notification)
        .where(Notification.target_user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if unread_only:
        q = q.where(Notification.is_read == False)

    rows = (await db.execute(q)).scalars().all()

    # Total unread count
    count_result = await db.execute(
        select(func.count(Notification.id))
        .where(Notification.target_user_id == user_id, Notification.is_read == False)
    )
    unread_count = count_result.scalar() or 0

    return {
        "unread_count": unread_count,
        "notifications": [
            {
                "id":                n.id,
                "type":              n.notification_type,
                "title":             n.title,
                "message":           n.message,
                "link_type":         n.link_type,
                "link_id":           n.link_id,
                "is_read":           n.is_read,
                "created_at":        n.created_at.isoformat(),
            }
            for n in rows
        ],
    }


# ── Mark one read ─────────────────────────────────────────────────────────────

# ── Mark all read (must be before /{notif_id}/read to avoid route conflict) ───

@notif_router.patch("/mark-all-read", summary="Mark all notifications as read")
async def mark_all_read(
    payload: dict = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    user_id = int(payload["sub"])
    await db.execute(
        update(Notification)
        .where(Notification.target_user_id == user_id, Notification.is_read == False)
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


# ── Mark one read ─────────────────────────────────────────────────────────────

@notif_router.patch("/{notif_id}/read", summary="Mark a notification as read")
async def mark_read(
    notif_id: int,
    payload: dict = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    user_id = int(payload["sub"])
    await db.execute(
        update(Notification)
        .where(Notification.id == notif_id, Notification.target_user_id == user_id)
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


# ── Delete one ────────────────────────────────────────────────────────────────

@notif_router.delete("/{notif_id}", summary="Delete a notification")
async def delete_notification(
    notif_id: int,
    payload: dict = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    user_id = int(payload["sub"])
    await db.execute(
        delete(Notification)
        .where(Notification.id == notif_id, Notification.target_user_id == user_id)
    )
    await db.commit()
    return {"ok": True}


# ── Admin broadcast ───────────────────────────────────────────────────────────

class AnnounceBody(BaseModel):
    title: str
    message: str
    target: Literal["all", "teachers", "students"]  # who receives it


@notif_router.post("/announce", summary="Admin: broadcast announcement")
async def announce(
    body: AnnounceBody,
    payload: dict = Depends(get_current_user_payload),
    db: AsyncSession = Depends(get_db),
):
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    actor_id = int(payload["sub"])

    from app.models.models import Role
    # Resolve target user_ids based on role name
    if body.target == "all":
        result = await db.execute(select(User.id).where(User.is_active == True))
        user_ids = [r[0] for r in result.all()]
    else:
        role_result = await db.execute(
            select(Role.id).where(Role.name == body.target.rstrip("s"))  # "teachers"→"teacher"
        )
        role_row = role_result.first()
        if not role_row:
            raise HTTPException(status_code=400, detail=f"Role '{body.target}' not found")
        result = await db.execute(
            select(User.id).where(User.is_active == True, User.role_id == role_row[0])
        )
        user_ids = [r[0] for r in result.all()]
    await NotificationService.notify_many(
        db,
        target_user_ids=user_ids,
        notification_type="announcement",
        title=body.title,
        message=body.message,
        actor_user_id=actor_id,
        link_type=None,
        link_id=None,
    )
    await db.commit()
    return {"ok": True, "sent_to": len(user_ids)}