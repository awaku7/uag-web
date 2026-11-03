"""Web UI for uagent (FastAPI).

Independent host for the UAG execution library.
"""

from __future__ import annotations

from .app import (
    BASE_DIR,
    STATIC_DIR,
    TEMPLATE_DIR,
    app,
    templates,
)
from .helpers import (
    ANSI_ESCAPE,
    _STATE_TOKEN_RE,
    _enrich_message_attachments,
    _lang_from_accept_language,
    _load_input_history,
    _save_input_history,
    _strip_state_markers,
)
from .rooms import (
    WebManager,
    WebRoom,
    _broadcast_modes_all,
    _handle_mode_command,
    _thread_ctx,
    web_manager,
)
from .io import (
    WebStderr,
    WebStdout,
    _web_console_log_enabled,
    _web_debug_enabled,
    _web_server_log,
    web_human_ask,
    web_set_status,
)
from .history import (
    _bootstrap_room_on_connect,
    _ensure_room_history_initialized,
)
from .agent_worker import run_agent_worker
from .routes_auth import (
    admin_auth_status,
    auth_status,
    oidc_callback,
    oidc_login,
    oidc_logout,
)
from .routes_pages import (
    get_local_file,
    get_room,
    get_root,
    upload_files,
)
from .routes_api import (
    _log_first_user_message,
    add_memory,
    api_command,
    clear_profile,
    delete_memory,
    get_log_preview,
    get_log_preview_by_path,
    get_logs,
    get_memories,
    get_profile,
    get_tools_enabled,
    profile_from_logs,
    set_tools_enabled,
    update_memory,
    update_profile,
)
from .routes_observability import get_observability_trace
from .routes_integration import get_integration_manifest
from . import routes_avatar  # noqa: F401 -- register independent avatar routes
from .routes_ws import websocket_endpoint
from .init import init_web, main as _web_main


def main():
    from uagent.runtime.observability.settings import consume_process_otel_cli_flags

    consume_process_otel_cli_flags()
    from uagent.runtime.process_registry import clear_tracking

    try:
        return _web_main()
    finally:
        clear_tracking("web")


__all__ = [
    "ANSI_ESCAPE",
    "BASE_DIR",
    "STATIC_DIR",
    "TEMPLATE_DIR",
    "WebManager",
    "WebRoom",
    "WebStderr",
    "WebStdout",
    "_STATE_TOKEN_RE",
    "_bootstrap_room_on_connect",
    "_broadcast_modes_all",
    "_enrich_message_attachments",
    "_ensure_room_history_initialized",
    "_handle_mode_command",
    "admin_auth_status",
    "auth_status",
    "_lang_from_accept_language",
    "_load_input_history",
    "_log_first_user_message",
    "_save_input_history",
    "_strip_state_markers",
    "_thread_ctx",
    "_web_console_log_enabled",
    "_web_debug_enabled",
    "_web_server_log",
    "add_memory",
    "api_command",
    "app",
    "clear_profile",
    "delete_memory",
    "get_local_file",
    "get_log_preview",
    "get_log_preview_by_path",
    "get_logs",
    "get_memories",
    "get_observability_trace",
    "get_profile",
    "get_room",
    "get_root",
    "get_tools_enabled",
    "get_integration_manifest",
    "oidc_callback",
    "oidc_login",
    "oidc_logout",
    "init_web",
    "main",
    "profile_from_logs",
    "run_agent_worker",
    "set_tools_enabled",
    "templates",
    "update_memory",
    "update_profile",
    "upload_files",
    "web_human_ask",
    "web_manager",
    "web_set_status",
    "websocket_endpoint",
]


if __name__ == "__main__":
    main()
