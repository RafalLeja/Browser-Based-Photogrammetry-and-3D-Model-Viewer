import hashlib
import secrets
import threading
import time
from collections import deque

from pwdlib import PasswordHash

# Argon2id with pwdlib's recommended parameters.
password_hash = PasswordHash.recommended()

# Verified against when the login does not exist, so a wrong login takes as long as a wrong password.
_DUMMY_HASH = password_hash.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def burn_password_check(password: str) -> None:
    password_hash.verify(password, _DUMMY_HASH)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RateLimiter:
    """Sliding-window limit per key (for example client IP + route), kept in memory.

    shortcut: per process only; with several API replicas move it to Redis or the reverse proxy.
    """

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True
