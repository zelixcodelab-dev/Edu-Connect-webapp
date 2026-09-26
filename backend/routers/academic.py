"""Academic-year metadata endpoint — powers the global year selector."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from auth_lib import get_current_user
from lib.academic_year import available_years, current_year

router = APIRouter(prefix="/api/academic-years", tags=["academic"])


@router.get("")
async def list_academic_years(user: dict = Depends(get_current_user)):
    return {"years": await available_years(), "current": current_year()}
