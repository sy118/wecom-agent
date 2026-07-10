import os

from oceanbase_mcp.server import app


def csv_env(name: str, defaults: list[str]) -> list[str]:
    raw = os.getenv(name, "")
    values = [value.strip() for value in raw.split(",") if value.strip()]
    return list(dict.fromkeys([*defaults, *values]))


security = app.settings.transport_security
security.allowed_hosts = csv_env(
    "MCP_ALLOWED_HOSTS",
    ["127.0.0.1:*", "localhost:*", "[::1]:*", "oceanbase-mcp:*"],
)
security.allowed_origins = csv_env(
    "MCP_ALLOWED_ORIGINS",
    ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*", "http://oceanbase-mcp:*"],
)

app.settings.host = os.getenv("MCP_HOST", "0.0.0.0")
app.settings.port = int(os.getenv("MCP_PORT", "8000"))
app.run(transport=os.getenv("MCP_TRANSPORT", "streamable-http"))
