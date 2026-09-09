---
"@hudrazine/pi-exa-web": patch
---

Replace raw Exa errors with safe package messages. Use separate anonymous and API-key MCP connections, including API-key initialization headers, and recover expired sessions once. Abort active HTTP requests on cancellation and close all connections under one shutdown grace period.
