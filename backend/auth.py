"""
Authentication helpers.

- Passwords are hashed with bcrypt directly (passlib has a version-mismatch
  issue with bcrypt 4.x on Python 3.13).
- Sessions use signed JWT tokens (HS256) stored client-side (Authorization: Bearer).
- Token expiry is 30 days.
- SECRET_KEY is read from the environment; a random fallback is generated at
  startup so the server works out-of-the-box.
"""
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlmodel import Session, select

from db import User, get_session

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_FALLBACK_KEY = secrets.token_hex(32)
SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", _FALLBACK_KEY)
ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

# ---------------------------------------------------------------------------
# Password hashing  (bcrypt directly, no passlib)
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def create_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> int:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise ValueError("missing sub")
        return int(sub)
    except (JWTError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ---------------------------------------------------------------------------
# FastAPI dependency  — use as: user: User = Depends(current_user)
# ---------------------------------------------------------------------------

_bearer = HTTPBearer()


def current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    session: Session = Depends(get_session),
) -> User:
    user_id = _decode_token(creds.credentials)
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user
