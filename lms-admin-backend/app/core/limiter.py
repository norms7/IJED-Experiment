from slowapi import Limiter
from slowapi.util import get_remote_address


def get_real_ip(request) -> str:
    """
    Extract the real client IP from behind Render's (or any) reverse proxy.

    Render injects the original client IP into the X-Forwarded-For header.
    Without this, SlowAPI sees the internal proxy IP for every request, so
    ALL users share one rate-limit bucket and get locked out together.

    Falls back to request.client.host when the header is absent (local dev).
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Header may contain a comma-separated chain; leftmost is the client
        return forwarded_for.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=get_real_ip,
    default_limits=["200/minute"],
)