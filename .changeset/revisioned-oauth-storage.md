---
"@hudrazine/pi-exa-web": minor
---

Require Node.js 24.15.0 or later and add the private storage foundation for OAuth credentials and routing settings. OAuth updates use SQLite exclusion and revisioned JSON; settings use validated atomic replacement. Add `/exa strategy` to save anonymous-first or authenticated-first routing. Anonymous limits now allow one no-header probe and a fixed cooldown, while authenticated credit errors allow one anonymous fallback. Show the successful route and expanded fallback reason without changing tool text. Interactive OAuth and runtime OAuth authentication will follow separately.
