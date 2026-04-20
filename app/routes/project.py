from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectResponse

router = APIRouter()

PROJECT_CODE_PREFIX = "PRJ-"


def build_next_project_code(db: Session) -> str:
    codes = [row[0] for row in db.query(Project.code).filter(Project.code.isnot(None)).all()]
    max_number = 0

    for code in codes:
        if not code:
            continue
        raw = str(code).strip().upper()
        if raw.startswith(PROJECT_CODE_PREFIX):
            raw = raw[len(PROJECT_CODE_PREFIX):]
        digits = "".join(ch for ch in raw if ch.isdigit())
        if digits:
            max_number = max(max_number, int(digits))

    return f"{PROJECT_CODE_PREFIX}{max_number + 1:04d}"

# DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# CREATE
@router.get("/projects/next-code")
def get_next_project_code(db: Session = Depends(get_db)):
    return {"code": build_next_project_code(db)}


@router.post("/projects", response_model=ProjectResponse)
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    payload = project.dict()
    payload["code"] = (payload.get("code") or "").strip() or build_next_project_code(db)
    new_project = Project(**payload)
    db.add(new_project)
    db.commit()
    db.refresh(new_project)
    return new_project

# READ ALL
@router.get("/projects", response_model=list[ProjectResponse])
def get_projects(db: Session = Depends(get_db)):
    return db.query(Project).all()

# READ ONE
@router.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

# UPDATE
@router.put("/projects/{project_id}", response_model=ProjectResponse)
def update_project(project_id: int, updated_project: ProjectCreate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    payload = updated_project.dict()
    if not str(payload.get("code") or "").strip():
        payload["code"] = project.code

    for key, value in payload.items():
        setattr(project, key, value)

    db.commit()
    db.refresh(project)

    return project

# DELETE
@router.delete("/projects/{project_id}")
def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    db.delete(project)
    db.commit()

    return {"message": "Project deleted successfully"}

# VALIDATE
@router.patch("/projects/{project_id}/validate", response_model=ProjectResponse)
def validate_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_validated = True
    db.commit()
    db.refresh(project)
    return project
