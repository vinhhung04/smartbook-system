"""The complete tool whitelist the assistant may call: the original analytics
tools (assistant_tools.py) plus the copilot's read-only composite tools
(copilot_tools.py). Kept in its own module because copilot_tools builds on
assistant_tools, so neither of the two can import the other's registry."""
from __future__ import annotations

from assistant_tools import ANALYTICS_TOOLS as _BASE_SCHEMAS
from assistant_tools import TOOL_FUNCTIONS as _BASE_FUNCTIONS
from copilot_tools import COPILOT_TOOL_FUNCTIONS, COPILOT_TOOLS

TOOL_FUNCTIONS = {**_BASE_FUNCTIONS, **COPILOT_TOOL_FUNCTIONS}
ANALYTICS_TOOLS = [*_BASE_SCHEMAS, *COPILOT_TOOLS]
