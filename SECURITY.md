# Security

## Reporting a problem

Please report vulnerabilities privately to the maintainers (open a GitHub security advisory on
this repository) rather than in a public issue. We aim to answer within a week.

## Security mechanisms

| Threat | Mechanism | Where |
|---|---|---|
| Password theft from the database | Argon2id hashes (`pwdlib` recommended parameters); passwords in their own table | `backend/app/core/security.py`, `models/password.py` |
| Login enumeration and timing | The same message for unknown login and wrong password; a dummy hash check for unknown logins | `api/routes/auth.py` |
| Brute force | 10 login attempts per minute per IP; 30 uploads per hour per curator; 30 shared views per minute per IP | `core/security.py` (`RateLimiter`), `main.py` |
| Session theft | Random 256-bit session tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` behind HTTPS); only the SHA-256 of the token is stored; logout deletes it; sessions expire after 14 days | `api/routes/auth.py`, `models/auth_session.py` |
| Cross-site request forgery | `SameSite=Lax` cookies, and every write is refused unless its `Origin` is our own site or an allowed origin | `main.py` (`guard` middleware) |
| Unauthorised changes | Every write endpoint requires a curator; drafts are invisible (404) to visitors | `api/deps.py`, routes |
| Malicious uploads | Files are recognised by magic bytes (JPEG, PNG), not by name or MIME type; saved under generated names; per-file, total and count limits enforced while streaming | `services/photos.py` |
| Zip slip | Names inside archives are never used as paths; every entry is written under a generated name | `services/photos.py` |
| Zip bombs | Entries larger than the photo limit or with a compression ratio above 50:1 are refused | `services/photos.py` |
| Path traversal in stored paths | Stored paths are resolved and must stay inside the storage or samples folder | `services/files.py` |
| Cross-site scripting | User text is stored as plain text with control characters removed and lengths limited; React renders it as text, never as HTML; nginx sends a Content-Security-Policy | `schemas/object.py`, `viewer/nginx.conf` |
| Open redirect after login | Only same-site paths are followed (`safeNext`) | `viewer/src/lib/format.ts` |
| Clickjacking | `frame-ancestors 'self'` for the app; only `/embed/` may be framed by other sites | `viewer/nginx.conf` |
| MIME sniffing and referrer leaks | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` on every response | `main.py`, `nginx.conf` |
| Sensitive responses cached | `Cache-Control: no-store` on auth and job responses | `main.py` |
| Crashes in native code | COLMAP runs in a child process, so a crash fails the job, not the API | `worker/runner.py` |
| Secrets in Git | Configuration comes from the environment or `backend/.env`, which is ignored; `.env.example` holds placeholders only | `.gitignore`, `backend/.env.example` |

## Known limits

- Rate limits are kept in memory per process. With several API replicas, enforce them in the
  reverse proxy or a shared store.
- There is one role (curator). Organisation-level roles and private collections are on the roadmap.
- Shared views can be created by anyone who can see an object; they hold only a camera and
  lighting state checked against a closed schema.
