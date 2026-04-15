from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
import json

from app.database import SessionLocal
from app.models import budget as budget_models
from app.models.project import Project
from app.schemas import budget as budget_schemas

router = APIRouter(prefix="", tags=["Budget"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/projects/{project_id}/budget", response_model=budget_schemas.BudgetResponse)
def get_or_create_budget(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    budget = (
        db.query(budget_models.Budget)
        .options(
            joinedload(budget_models.Budget.scopes)
            .joinedload(budget_models.Scope.sections)
            .joinedload(budget_models.SectionBudgetaire.sous_sections)
            .joinedload(budget_models.SousSection.lignes_otp)
            .joinedload(budget_models.LigneOTP.details_mensuels)
        )
        .filter(
            budget_models.Budget.projet_id == project_id,
            budget_models.Budget.statut == "BROUILLON",
        )
        .first()
    )

    def parse_project_scopes(raw):
        if not raw:
            return []
        try:
            v = json.loads(raw)
            if isinstance(v, list):
                names = []
                for item in v:
                    if isinstance(item, dict):
                        candidate = (
                            item.get("name")
                            or item.get("nom")
                            or item.get("scope")
                            or ""
                        )
                    else:
                        candidate = str(item)
                    candidate = str(candidate).strip()
                    if candidate:
                        names.append(candidate)
                return names
        except Exception:
            pass
        # fallback: string simple séparée par virgule / saut de ligne / point-virgule
        s = str(raw)
        for sep in ["\n", ";"]:
            s = s.replace(sep, ",")
        return [x.strip() for x in s.split(",") if x.strip()]

    wanted_scopes = parse_project_scopes(project.scope)

    if budget:
        # sync robuste:
        # - renommage par position (évite ancien nom + nouveau nom)
        # - ajout des scopes manquants
        # - suppression des scopes en trop uniquement s'ils sont vides
        existing_scopes = sorted((budget.scopes or []), key=lambda s: s.id)
        changed = False

        # 1) renommer les scopes déjà existants par index
        common_len = min(len(existing_scopes), len(wanted_scopes))
        for i in range(common_len):
            if existing_scopes[i].nom != wanted_scopes[i]:
                existing_scopes[i].nom = wanted_scopes[i]
                changed = True

        # 2) ajouter les nouveaux scopes
        for name in wanted_scopes[common_len:]:
            db.add(budget_models.Scope(nom=name, budget_id=budget.id))
            changed = True

        # 3) supprimer les scopes excédentaires seulement s'ils n'ont pas de données
        for extra in existing_scopes[len(wanted_scopes):]:
            has_data = any((sec.sous_sections or []) for sec in (extra.sections or []))
            if not has_data:
                db.delete(extra)
                changed = True

        if changed:
            db.commit()

        return (
            db.query(budget_models.Budget)
            .options(
                joinedload(budget_models.Budget.scopes)
                .joinedload(budget_models.Scope.sections)
                .joinedload(budget_models.SectionBudgetaire.sous_sections)
                .joinedload(budget_models.SousSection.lignes_otp)
                .joinedload(budget_models.LigneOTP.details_mensuels)
            )
            .filter(budget_models.Budget.id == budget.id)
            .first()
        )

    budget = budget_models.Budget(projet_id=project_id, statut="BROUILLON")
    db.add(budget)
    db.commit()
    db.refresh(budget)

    # créer automatiquement les scopes du budget à partir du projet
    for name in wanted_scopes:
        db.add(budget_models.Scope(nom=name, budget_id=budget.id))
    if wanted_scopes:
        db.commit()
        db.refresh(budget)
    return budget


@router.get("/budgets/{budget_id}/scopes", response_model=List[budget_schemas.ScopeResponse])
def list_scopes(budget_id: int, db: Session = Depends(get_db)):
    return (
        db.query(budget_models.Scope)
        .options(joinedload(budget_models.Scope.sections))
        .filter(budget_models.Scope.budget_id == budget_id)
        .all()
    )


@router.post("/budgets/{budget_id}/scopes", response_model=budget_schemas.ScopeResponse)
def create_scope(budget_id: int, payload: budget_schemas.ScopeBase, db: Session = Depends(get_db)):
    budget = db.query(budget_models.Budget).filter(budget_models.Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    scope = budget_models.Scope(nom=payload.nom, budget_id=budget_id)
    db.add(scope)
    db.commit()
    db.refresh(scope)
    return scope


@router.delete("/scopes/{scope_id}")
def delete_scope(scope_id: int, db: Session = Depends(get_db)):
    scope = db.query(budget_models.Scope).filter(budget_models.Scope.id == scope_id).first()
    if not scope:
        raise HTTPException(status_code=404, detail="Scope not found")
    db.delete(scope)
    db.commit()
    return {"message": "Scope deleted"}


@router.get("/catalogue/sections/", response_model=List[budget_schemas.CatalogueSectionResponse])
def obtenir_catalogue(db: Session = Depends(get_db)):
    return db.query(budget_models.CatalogueSection).all()


@router.post("/catalogue/import")
def import_catalogue(payload: budget_schemas.CatalogueImportPayload, db: Session = Depends(get_db)):
    """
    Import idempotent:
    - Section: unique sur nom_section
    - Sous-section: unique (section_id, nom_sous_section)
    - OTP: unique sur code_otp
    """

    inserted = {"sections": 0, "sous_sections": 0, "otps": 0}
    updated = {"otps": 0}

    for sec in payload.sections or []:
        section = (
            db.query(budget_models.CatalogueSection)
            .filter(budget_models.CatalogueSection.nom_section == sec.nom_section)
            .first()
        )
        if not section:
            section = budget_models.CatalogueSection(nom_section=sec.nom_section)
            db.add(section)
            db.flush()
            inserted["sections"] += 1

        for ss in sec.sous_sections or []:
            sous_section = (
                db.query(budget_models.CatalogueSousSection)
                .filter(
                    budget_models.CatalogueSousSection.section_id == section.id,
                    budget_models.CatalogueSousSection.nom_sous_section == ss.nom_sous_section,
                )
                .first()
            )
            if not sous_section:
                sous_section = budget_models.CatalogueSousSection(
                    nom_sous_section=ss.nom_sous_section,
                    section_id=section.id,
                )
                db.add(sous_section)
                db.flush()
                inserted["sous_sections"] += 1

            for otp in ss.otps or []:
                existing_otp = (
                    db.query(budget_models.CatalogueOTP)
                    .filter(budget_models.CatalogueOTP.code_otp == otp.code_otp)
                    .first()
                )
                if not existing_otp:
                    db.add(
                        budget_models.CatalogueOTP(
                            code_otp=otp.code_otp,
                            designation=otp.designation,
                            unite=otp.unite,
                            prix_unitaire_reference=otp.prix_unitaire_reference or 0.0,
                            sous_section_id=sous_section.id,
                        )
                    )
                    inserted["otps"] += 1
                else:
                    # on met à jour si le code existe déjà (et on rattache à la sous-section)
                    existing_otp.designation = otp.designation
                    existing_otp.unite = otp.unite
                    existing_otp.prix_unitaire_reference = otp.prix_unitaire_reference or 0.0
                    existing_otp.sous_section_id = sous_section.id
                    updated["otps"] += 1

    db.commit()
    return {"inserted": inserted, "updated": updated}


@router.get(
    "/catalogue/sections/{section_id}/sous-sections",
    response_model=List[budget_schemas.CatalogueSousSectionResponse],
)
def obtenir_catalogue_sous_sections(section_id: int, db: Session = Depends(get_db)):
    return (
        db.query(budget_models.CatalogueSousSection)
        .filter(budget_models.CatalogueSousSection.section_id == section_id)
        .all()
    )


@router.get(
    "/catalogue/sous-sections/{sous_section_id}/otps",
    response_model=List[budget_schemas.CatalogueOTPResponse],
)
def obtenir_catalogue_otps(sous_section_id: int, db: Session = Depends(get_db)):
    return (
        db.query(budget_models.CatalogueOTP)
        .filter(budget_models.CatalogueOTP.sous_section_id == sous_section_id)
        .all()
    )


@router.post("/scopes/{scope_id}/sections", response_model=List[budget_schemas.SectionBudgetaireResponse])
def assign_sections(scope_id: int, catalogue_ids: List[int], db: Session = Depends(get_db)):
    scope = (
        db.query(budget_models.Scope)
        .options(joinedload(budget_models.Scope.sections))
        .filter(budget_models.Scope.id == scope_id)
        .first()
    )
    if not scope:
        raise HTTPException(status_code=404, detail="Scope not found")

    existing = {s.catalogue_id: s for s in scope.sections}
    keep = set(catalogue_ids)

    for cat_id, sec in existing.items():
        if cat_id not in keep:
            db.delete(sec)

    for cat_id in catalogue_ids:
        if cat_id in existing:
            continue
        cat = (
            db.query(budget_models.CatalogueSection)
            .filter(budget_models.CatalogueSection.id == cat_id)
            .first()
        )
        if not cat:
            raise HTTPException(status_code=400, detail=f"Catalogue section {cat_id} introuvable")
        db.add(
            budget_models.SectionBudgetaire(
                nom=cat.nom_section,
                total_section=0.0,
                scope_id=scope_id,
                catalogue_id=cat_id,
            )
        )

    db.commit()
    scope = (
        db.query(budget_models.Scope)
        .options(joinedload(budget_models.Scope.sections))
        .filter(budget_models.Scope.id == scope_id)
        .first()
    )
    return scope.sections


@router.post(
    "/sections/{section_id}/sous-sections",
    response_model=budget_schemas.SousSectionResponse,
)
def create_sous_section(section_id: int, payload: budget_schemas.SousSectionBase, db: Session = Depends(get_db)):
    section = (
        db.query(budget_models.SectionBudgetaire)
        .filter(budget_models.SectionBudgetaire.id == section_id)
        .first()
    )
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")

    ss = budget_models.SousSection(
        nom=payload.nom,
        total_sous_section=payload.total_sous_section or 0.0,
        section_id=section_id,
    )
    db.add(ss)
    db.commit()
    db.refresh(ss)
    return ss


@router.delete("/sous-sections/{sous_section_id}")
def delete_sous_section(sous_section_id: int, db: Session = Depends(get_db)):
    ss = (
        db.query(budget_models.SousSection)
        .filter(budget_models.SousSection.id == sous_section_id)
        .first()
    )
    if not ss:
        raise HTTPException(status_code=404, detail="Sous-section not found")
    db.delete(ss)
    db.commit()
    return {"message": "Sous-section deleted"}


@router.post(
    "/sous-sections/{sous_section_id}/lignes-otp",
    response_model=budget_schemas.LigneOTPResponse,
)
def create_ligne_otp(
    sous_section_id: int, payload: budget_schemas.LigneOTPCreate, db: Session = Depends(get_db)
):
    ss = (
        db.query(budget_models.SousSection)
        .filter(budget_models.SousSection.id == sous_section_id)
        .first()
    )
    if not ss:
        raise HTTPException(status_code=404, detail="Sous-section not found")

    line = budget_models.LigneOTP(
        code_otp=payload.code_otp,
        designation=payload.designation,
        unite=payload.unite,
        quantite_globale=payload.quantite_globale,
        prix_unitaire=payload.prix_unitaire,
        montant_total=payload.montant_total,
        sous_section_id=sous_section_id,
    )
    db.add(line)
    db.flush()  # pour récupérer line.id avant les details

    for d in payload.details_mensuels or []:
        db.add(
            budget_models.DetailMensuel(
                mois=d.mois,
                annee=d.annee,
                quantite=d.quantite,
                ligne_otp_id=line.id,
            )
        )

    db.commit()
    line = (
        db.query(budget_models.LigneOTP)
        .options(joinedload(budget_models.LigneOTP.details_mensuels))
        .filter(budget_models.LigneOTP.id == line.id)
        .first()
    )
    return line


@router.put("/lignes-otp/{ligne_id}", response_model=budget_schemas.LigneOTPResponse)
def update_ligne_otp(ligne_id: int, payload: budget_schemas.LigneOTPCreate, db: Session = Depends(get_db)):
    line = (
        db.query(budget_models.LigneOTP)
        .options(joinedload(budget_models.LigneOTP.details_mensuels))
        .filter(budget_models.LigneOTP.id == ligne_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Ligne OTP not found")

    line.code_otp = payload.code_otp
    line.designation = payload.designation
    line.unite = payload.unite
    line.quantite_globale = payload.quantite_globale
    line.prix_unitaire = payload.prix_unitaire
    line.montant_total = payload.montant_total

    # stratégie simple: remplacer complètement les détails mensuels
    for existing in list(line.details_mensuels or []):
        db.delete(existing)

    db.flush()

    for d in payload.details_mensuels or []:
        db.add(
            budget_models.DetailMensuel(
                mois=d.mois,
                annee=d.annee,
                quantite=d.quantite,
                ligne_otp_id=line.id,
            )
        )

    db.commit()
    db.refresh(line)
    return line


@router.delete("/lignes-otp/{ligne_id}")
def delete_ligne_otp(ligne_id: int, db: Session = Depends(get_db)):
    line = db.query(budget_models.LigneOTP).filter(budget_models.LigneOTP.id == ligne_id).first()
    if not line:
        raise HTTPException(status_code=404, detail="Ligne OTP not found")
    db.delete(line)
    db.commit()
    return {"message": "Ligne OTP deleted"}


@router.get(
    "/sections/{section_id}/lignes",
    response_model=List[budget_schemas.SousSectionResponse],
)
def list_lignes_by_section(section_id: int, db: Session = Depends(get_db)):
    section = (
        db.query(budget_models.SectionBudgetaire)
        .options(
            joinedload(budget_models.SectionBudgetaire.sous_sections)
            .joinedload(budget_models.SousSection.lignes_otp)
            .joinedload(budget_models.LigneOTP.details_mensuels)
        )
        .filter(budget_models.SectionBudgetaire.id == section_id)
        .first()
    )
    if not section:
        raise HTTPException(status_code=404, detail="Section not found")
    return section.sous_sections


@router.post("/budgets/{budget_id}/recalculate", response_model=budget_schemas.BudgetResponse)
def recalculate_budget(budget_id: int, db: Session = Depends(get_db)):
    budget = (
        db.query(budget_models.Budget)
        .options(
            joinedload(budget_models.Budget.scopes)
            .joinedload(budget_models.Scope.sections)
            .joinedload(budget_models.SectionBudgetaire.sous_sections)
            .joinedload(budget_models.SousSection.lignes_otp)
        )
        .filter(budget_models.Budget.id == budget_id)
        .first()
    )
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    total_global = 0.0
    for scope in budget.scopes or []:
        total_scope = 0.0
        for section in scope.sections or []:
            total_section = 0.0
            for ss in section.sous_sections or []:
                total_ss = 0.0
                for line in ss.lignes_otp or []:
                    total_ss += float(line.montant_total or 0.0)
                ss.total_sous_section = total_ss
                total_section += total_ss
            section.total_section = total_section
            total_scope += total_section
        scope.total_scope = total_scope
        total_global += total_scope

    budget.total_global = total_global
    db.commit()
    db.refresh(budget)

    budget = (
        db.query(budget_models.Budget)
        .options(
            joinedload(budget_models.Budget.scopes)
            .joinedload(budget_models.Scope.sections)
            .joinedload(budget_models.SectionBudgetaire.sous_sections)
            .joinedload(budget_models.SousSection.lignes_otp)
            .joinedload(budget_models.LigneOTP.details_mensuels)
        )
        .filter(budget_models.Budget.id == budget_id)
        .first()
    )
    return budget


@router.patch("/budgets/{budget_id}/validate", response_model=budget_schemas.BudgetResponse)
def validate_budget(budget_id: int, db: Session = Depends(get_db)):
    budget = db.query(budget_models.Budget).filter(budget_models.Budget.id == budget_id).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    budget.statut = "VALIDE"
    db.commit()
    db.refresh(budget)
    return budget
