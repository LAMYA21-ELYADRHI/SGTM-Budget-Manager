from pydantic import BaseModel
from datetime import date
from typing import Optional

class ProjectCreate(BaseModel):
    code: str = ""
    name: str
    client: str
    pole: str
    location: str
    project_manager: str
    start_date: date
    end_date: date
    is_group: bool
    is_validated: bool = False
    group_names: str = ""  # JSON string
    scope: str
    project_type: str
    market_amount: int = 0
    scope_date: Optional[date] = None  # legacy
    scope_start_date: Optional[date] = None
    scope_end_date: Optional[date] = None


class ProjectResponse(ProjectCreate):
    id: int

    class Config:
        from_attributes = True
