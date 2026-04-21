from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
import json

from app.database import SessionLocal
from app.models import budget as budget_models
from app.models.project import Project
from app.schemas import budget as budget_schemas

router = APIRouter(prefix="", tags=["Budget"])

SECTION_ALIASES = {
    "INSTALLATION": {"S1", "INSTALLATION"},
    "HSE": {"S2", "HSE"},
    "MASSE_SALARIALE": {"S3", "MASSE SALARIALE", "MASSE_SALARIALE"},
    "MATERIEL": {"S4", "MATERIEL", "MATÉRIEL"},
    "GASOIL": {"S5", "GASOIL"},
    "SOUSTRAITANCE": {"S6", "SOUSTRAITANCE", "SOUS TRAITANCE"},
    "FOURNITURES": {"FOURNITURES"},
    "AUTRES_CHARGES": {"AUTRES_CHARGES", "AUTRE CHARGES", "AUTRES CHARGES", "AUTRES"},
}


def normalize_text(value):
    return (
        str(value or "")
        .strip()
        .upper()
        .replace("É", "E")
        .replace("È", "E")
        .replace("Ê", "E")
        .replace("À", "A")
        .replace("Â", "A")
        .replace("Î", "I")
        .replace("Ô", "O")
        .replace("Ù", "U")
        .replace("Û", "U")
        .replace("Ç", "C")
        .replace("_", "")
        .replace("-", "")
        .replace(" ", "")
    )


def canonical_section_code(value):
    normalized = normalize_text(value)
    if not normalized:
        return ""

    for code, aliases in SECTION_ALIASES.items():
        if normalized == normalize_text(code):
            return code
        if any(normalized == normalize_text(alias) for alias in aliases):
            return code
    return normalized


def resolve_scope_section_id(db: Session, selected_section_codes):
    catalogue_sections = db.query(budget_models.CatalogueSection).all()
    by_code = {
        canonical_section_code(section.nom_section): section.id for section in catalogue_sections
    }
    for code in selected_section_codes or []:
        section_id = by_code.get(canonical_section_code(code))
        if section_id:
            return section_id
    return None


def parse_project_scopes(raw):
    if not raw:
        return []

    try:
        value = json.loads(raw)
        if isinstance(value, list):
            parsed = []
            for item in value:
                if isinstance(item, dict):
                    name = (
                        item.get("name")
                        or item.get("nom")
                        or item.get("scope")
                        or ""
                    )
                    sections = item.get("sections") or []
                else:
                    name = str(item)
                    sections = []
                name = str(name).strip()
                if not name:
                    continue
                parsed.append(
                    {
                        "name": name,
                        "sections": [
                            canonical_section_code(section)
                            for section in sections
                            if canonical_section_code(section)
                        ],
                    }
                )
            return parsed
    except Exception:
        pass

    # fallback legacy: simple string séparée par virgule / saut de ligne / point-virgule
    s = str(raw)
    for sep in ["\n", ";"]:
        s = s.replace(sep, ",")
    return [{"name": x.strip(), "sections": []} for x in s.split(",") if x.strip()]


def sync_scope_sections(db: Session, scope, selected_section_codes):
    catalogue_sections = db.query(budget_models.CatalogueSection).all()
    catalogue_by_code = {
        canonical_section_code(section.nom_section): section for section in catalogue_sections
    }

    desired_codes = []
    for code in selected_section_codes or []:
        normalized = canonical_section_code(code)
        if normalized and normalized not in desired_codes:
            desired_codes.append(normalized)
    if not desired_codes:
        desired_codes = [canonical_section_code(section.nom_section) for section in catalogue_sections]

    existing_sections = sorted((scope.sections or []), key=lambda section: section.id)
    existing_by_code = {
        canonical_section_code(section.nom): section for section in existing_sections
    }
    desired_lookup = {canonical_section_code(code) for code in desired_codes}

    for code in desired_codes:
        catalogue_section = catalogue_by_code.get(canonical_section_code(code))
        if not catalogue_section:
            continue

        existing_section = existing_by_code.get(canonical_section_code(catalogue_section.nom_section))
        if existing_section:
            existing_section.nom = catalogue_section.nom_section
            existing_section.catalogue_id = catalogue_section.id
            continue

        db.add(
            budget_models.SectionBudgetaire(
                nom=catalogue_section.nom_section,
                catalogue_id=catalogue_section.id,
                scope_id=scope.id,
            )
        )

    for extra in existing_sections:
        if canonical_section_code(extra.nom) in desired_lookup:
            continue
        has_data = any((ss.lignes_otp or []) for ss in (extra.sous_sections or []))
        if not has_data:
            db.delete(extra)

    scope.section_id = resolve_scope_section_id(db, desired_codes)


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
            wanted_scope = wanted_scopes[i]
            if existing_scopes[i].nom != wanted_scope["name"]:
                existing_scopes[i].nom = wanted_scope["name"]
                changed = True
            sync_scope_sections(db, existing_scopes[i], wanted_scope.get("sections", []))
            changed = True

        # 2) ajouter les nouveaux scopes
        for scope_data in wanted_scopes[common_len:]:
            new_scope = budget_models.Scope(
                nom=scope_data["name"],
                budget_id=budget.id,
                section_id=resolve_scope_section_id(db, scope_data.get("sections", [])),
            )
            db.add(new_scope)
            changed = True

        # 3) supprimer les scopes excédentaires seulement s'ils n'ont pas de données
        for extra in existing_scopes[len(wanted_scopes):]:
            has_data = any((sec.sous_sections or []) for sec in (extra.sections or []))
            if not has_data:
                db.delete(extra)
                changed = True

        if changed:
            db.commit()

        # Resynchronisation des sections après commit pour les scopes nouvellement ajoutés
        refreshed_budget = (
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
        if refreshed_budget:
            refreshed_scopes = sorted((refreshed_budget.scopes or []), key=lambda s: s.id)
        for scope, wanted_scope in zip(refreshed_scopes, wanted_scopes):
            sync_scope_sections(db, scope, wanted_scope.get("sections", []))
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
    for scope_data in wanted_scopes:
        db.add(
            budget_models.Scope(
                nom=scope_data["name"],
                budget_id=budget.id,
                section_id=resolve_scope_section_id(db, scope_data.get("sections", [])),
            )
        )
    if wanted_scopes:
        db.commit()
        budget = (
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
        for scope, wanted_scope in zip(budget.scopes or [], wanted_scopes):
            sync_scope_sections(db, scope, wanted_scope.get("sections", []))
        db.commit()
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
    scope = budget_models.Scope(
        nom=payload.nom,
        budget_id=budget_id,
        section_id=payload.section_id,
    )
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
        nombre_jours=payload.nombre_jours,
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
    line.nombre_jours = payload.nombre_jours
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


@router.post("/lignes-otp/{ligne_id}/duplicate", response_model=budget_schemas.LigneOTPResponse)
def duplicate_ligne_otp(ligne_id: int, db: Session = Depends(get_db)):
    source = (
        db.query(budget_models.LigneOTP)
        .options(joinedload(budget_models.LigneOTP.details_mensuels))
        .filter(budget_models.LigneOTP.id == ligne_id)
        .first()
    )
    if not source:
        raise HTTPException(status_code=404, detail="Ligne OTP not found")

    new_line = budget_models.LigneOTP(
        code_otp=source.code_otp,
        designation=source.designation,
        unite=source.unite,
        nombre_jours=source.nombre_jours,
        quantite_globale=source.quantite_globale,
        prix_unitaire=source.prix_unitaire,
        montant_total=source.montant_total,
        sous_section_id=source.sous_section_id,
    )
    db.add(new_line)
    db.flush()

    for detail in source.details_mensuels or []:
        db.add(
            budget_models.DetailMensuel(
                mois=detail.mois,
                annee=detail.annee,
                quantite=detail.quantite,
                ligne_otp_id=new_line.id,
            )
        )

    db.commit()
    new_line = (
        db.query(budget_models.LigneOTP)
        .options(joinedload(budget_models.LigneOTP.details_mensuels))
        .filter(budget_models.LigneOTP.id == new_line.id)
        .first()
    )
    return new_line


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
