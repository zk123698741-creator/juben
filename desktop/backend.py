"""Private loopback server owned by the desktop process."""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sys
import threading

for stream in (sys.stdout, sys.stderr):
    if stream is not None and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace")

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(ROOT))


def configure_runtime() -> Path:
    from dotenv import load_dotenv

    data = Path(os.environ["JUBEN_DESKTOP_DATA"]).resolve()
    data.mkdir(parents=True, exist_ok=True)
    os.chdir(data)
    load_dotenv(data / ".env", override=True)
    # These are desktop invariants, independent of editable provider settings.
    os.environ.update({
        "APP_ENV": "development", "AUTH_ENABLED": "false", "DEBUG": "false",
        "JUBEN_LOG_DIR": str(data / "logs"),
        "USER_DB_PATH": str(data / "data" / "users.db"),
        "RATE_LIMIT_RPM": "3000", "REDIS_WARMUP_TIMEOUT": "0.5",
    })
    identity_file = data / "identity.json"
    if not identity_file.exists():
        identity_file.write_text(json.dumps({
            "jwt": secrets.token_urlsafe(48), "password": secrets.token_urlsafe(32),
        }), encoding="utf-8")
    identity = json.loads(identity_file.read_text(encoding="utf-8"))
    os.environ.update({
        "JWT_SECRET_KEY": identity["jwt"], "ADMIN_USERNAME": "desktop",
        "ADMIN_PASSWORD": identity["password"], "ADMIN_EMAIL": "desktop@localhost.local",
    })
    os.environ.pop("ADMIN_PASSWORD_HASH", None)
    # Some upstream loaders resolve resources relative to the working directory.
    for directory in ("prompts", "skills", "config"):
        source, target = ROOT / directory, data / directory
        if source.exists():
            shutil.copytree(source, target, dirs_exist_ok=True)
    return data


class DesktopGate:
    """All HTTP/WebSocket traffic needs the per-launch capability held by Electron."""
    def __init__(self, app, token: str):
        self.app = app
        self.token = token.encode("ascii")

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            if not secrets.compare_digest(headers.get(b"x-juben-desktop", b""), self.token):
                if scope["type"] == "websocket":
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    await send({"type": "http.response.start", "status": 403, "headers": []})
                    await send({"type": "http.response.body", "body": b"Desktop session required"})
                return
        await self.app(scope, receive, send)


def build_app():
    from main import app
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    from fastapi.routing import APIRoute
    from apis.auth.api_routes_auth import login, LoginRequest

    async def ready():
        return {"ready": True}

    async def session():
        return await login(LoginRequest(username=os.environ["ADMIN_USERNAME"],
                                        password=os.environ["ADMIN_PASSWORD"]))

    # Insert before the upstream static mount, so it cannot swallow these endpoints.
    app.router.routes.insert(0, APIRoute("/__desktop/ready", ready))
    app.router.routes.insert(0, APIRoute("/__desktop/session", session))
    # React BrowserRouter needs a fallback when refreshing a nested page.
    frontend = (ROOT / "frontend" / "dist").resolve()
    if app.router.routes and getattr(app.router.routes[-1], "name", None) == "frontend":
        app.router.routes.pop()

    async def frontend_route(path: str):
        candidate = (frontend / path).resolve()
        if candidate.is_relative_to(frontend) and candidate.is_file():
            return FileResponse(candidate)
        if path.startswith(("assets/", "auth/", "juben/", "graph/", "__desktop/")):
            raise HTTPException(404)
        return FileResponse(frontend / "index.html")

    app.add_api_route("/{path:path}", frontend_route, methods=["GET"], include_in_schema=False)
    return DesktopGate(app, os.environ["JUBEN_DESKTOP_TOKEN"])


def main():
    data = configure_runtime()
    import uvicorn

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # Keep the same origin across launches so localStorage preferences survive.
    port_file = data / "port.json"
    try:
        previous_port = int(json.loads(port_file.read_text(encoding="utf-8")))
        if not 1024 <= previous_port <= 65535:
            previous_port = 0
    except (OSError, ValueError, TypeError):
        previous_port = 0
    try:
        sock.bind(("127.0.0.1", previous_port))
    except OSError:
        sock.close()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    port = sock.getsockname()[1]
    port_file.write_text(json.dumps(port), encoding="utf-8")
    os.environ["ALLOWED_ORIGINS"] = f"http://127.0.0.1:{port}"
    application = build_app()
    server = uvicorn.Server(uvicorn.Config(application, log_level="info", access_log=False,
                                          loop="asyncio", ws="websockets"))

    def watch_parent():
        # Pipe EOF also occurs if Electron crashes, preventing an orphan server.
        try:
            sys.stdin.buffer.read()
        finally:
            server.should_exit = True

    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps({"juben_desktop_port": port}), flush=True)
    try:
        server.run(sockets=[sock])
    finally:
        sock.close()


if __name__ == "__main__":
    from multiprocessing import freeze_support
    freeze_support()
    main()
