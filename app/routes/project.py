from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.database import SessionLocal
from app.models.project import Project
from app.models import budget as budget_models
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


def clone_project_budget(source_project: Project, target_project: Project, db: Session):
    source_budgets = (
        db.query(budget_models.Budget)
        .options(
            joinedload(budget_models.Budget.scopes)
            .joinedload(budget_models.Scope.sections)
            .joinedload(budget_models.SectionBudgetaire.sous_sections)
            .joinedload(budget_models.SousSection.lignes_otp)
            .joinedload(budget_models.LigneOTP.details_mensuels)
        )
        .filter(budget_models.Budget.projet_id == source_project.id)
        .all()
    )

    for source_budget in source_budgets:
        new_budget = budget_models.Budget(
            statut="BROUILLON",
            total_global=source_budget.total_global,
            projet_id=target_project.id,
        )
        db.add(new_budget)
        db.flush()

        for source_scope in source_budget.scopes or []:
            new_scope = budget_models.Scope(
                nom=source_scope.nom,
                total_scope=source_scope.total_scope,
                budget_id=new_budget.id,
                section_id=source_scope.section_id,
            )
            db.add(new_scope)
            db.flush()

            for source_section in source_scope.sections or []:
                new_section = budget_models.SectionBudgetaire(
                    nom=source_section.nom,
                    total_section=source_section.total_section,
                    scope_id=new_scope.id,
                    catalogue_id=source_section.catalogue_id,
                )
                db.add(new_section)
                db.flush()

                for source_ss in source_section.sous_sections or []:
                    new_ss = budget_models.SousSection(
                        nom=source_ss.nom,
                        total_sous_section=source_ss.total_sous_section,
                        section_id=new_section.id,
                    )
                    db.add(new_ss)
                    db.flush()

                    for source_line in source_ss.lignes_otp or []:
                        new_line = budget_models.LigneOTP(
                            code_otp=source_line.code_otp,
                            section=source_line.section,
                            designation=source_line.designation,
                            unite=source_line.unite,
                            nombre_jours=source_line.nombre_jours,
                            quantite_globale=source_line.quantite_globale,
                            prix_unitaire=source_line.prix_unitaire,
                            montant_total=source_line.montant_total,
                            heures_marche=source_line.heures_marche,
                            consommation_l_h=source_line.consommation_l_h,
                            sous_section_id=new_ss.id,
                        )
                        db.add(new_line)
                        db.flush()

                        for source_detail in source_line.details_mensuels or []:
                            db.add(
                                budget_models.DetailMensuel(
                                    mois=source_detail.mois,
                                    annee=source_detail.annee,
                                    quantite=source_detail.quantite,
                                    montant_brut=getattr(source_detail, "montant_brut", 0.0),
                                    montant_net=getattr(source_detail, "montant_net", 0.0),
                                    ligne_otp_id=new_line.id,
                                )
                            )


@router.post("/projects/{project_id}/duplicate", response_model=ProjectResponse)
def duplicate_project(project_id: int, db: Session = Depends(get_db)):
    source_project = db.query(Project).filter(Project.id == project_id).first()
    if not source_project:
        raise HTTPException(status_code=404, detail="Project not found")

    new_project = Project(
        code=build_next_project_code(db),
        name=source_project.name,
        client=source_project.client,
        pole=source_project.pole,
        location=source_project.location,
        project_manager=source_project.project_manager,
        start_date=source_project.start_date,
        end_date=source_project.end_date,
        is_group=source_project.is_group,
        is_validated=False,
        group_names=source_project.group_names,
        scope=source_project.scope,
        project_type=source_project.project_type,
        market_amount=source_project.market_amount,
        scope_date=source_project.scope_date,
        scope_start_date=source_project.scope_start_date,
        scope_end_date=source_project.scope_end_date,
    )
    db.add(new_project)
    db.flush()

    clone_project_budget(source_project, new_project, db)

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
