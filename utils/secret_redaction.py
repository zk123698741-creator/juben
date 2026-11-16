"""Shared output redaction used by SSE and agent output hooks."""
import os
import re

_ENV_SECRET = re.compile(r"(?:API_KEY|SECRET|PASSWORD|ACCESS_TOKEN|AUTH_TOKEN|JWT_KEY)$", re.I)
_BEARER = re.compile(r"(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}", re.I)
_API_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b")


def redact_secrets(content: str) -> str:
    if not isinstance(content, str) or not content:
        return content
    # Read at call time: desktop configuration is loaded during startup.
    values = {value for key, value in os.environ.items()
              if _ENV_SECRET.search(key) and len(value) >= 8}
    for value in sorted(values, key=len, reverse=True):
        content = content.replace(value, "xx")
    content = _BEARER.sub(r"\1xx", content)
    return _API_KEY.sub("xx", content)
