"""API key authentication.

Three roles: admin can do anything, staff can move stock and manage orders,
readonly can only read.
"""

from fastapi import Header, HTTPException, status

from .config import settings

ROLE_RANK = {"readonly": 0, "staff": 1, "admin": 2}


class Principal:
    def __init__(self, key: str, role: str):
        self.key = key
        self.role = role

    def can(self, required: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[required]

    def __repr__(self) -> str:
        return f"Principal(role={self.role}, key={self.key})"


def resolve(x_api_key: str = Header(default="")) -> Principal:
    role = settings.api_keys.get(x_api_key)
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"unknown api key: {x_api_key}",
        )
    return Principal(x_api_key, role)


def require(role: str):
    """Dependency factory enforcing a minimum role."""

    def dependency(x_api_key: str = Header(default="")) -> Principal:
        principal = resolve(x_api_key)
        if not principal.can(role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"{principal.role} cannot perform this action, {role} required",
            )
        return principal

    return dependency


require_admin = require("admin")
require_staff = require("staff")
require_readonly = require("readonly")
