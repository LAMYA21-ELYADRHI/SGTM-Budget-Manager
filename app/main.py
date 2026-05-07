from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.models.project import Project
from app.routes.project import router as project_router
from app.routes.budget import router as budget_router
from sqlalchemy import text
from app.models import budget  # important pour crÃ©er tables
from app.models import analytics  # important pour crÃ©er tables analytiques
from app.models.budget import CatalogueSection, Scope, CsvCatalogue, CsvCatalogueRow
from app.models.analytics import DimCostType, DimDate, date_to_key
from sqlalchemy.orm import Session
from datetime import datetime, date
from pathlib import Path
import csv
import json

app = FastAPI()

# Autoriser le frontend React (CRA) en dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#  crÃ©er les tables dans SQLite
Base.metadata.create_all(bind=engine)

# Mini-migration SQLite: ajouter des colonnes si absentes
with engine.begin() as conn:
    cols = conn.execute(text("PRAGMA table_info(projects)")).fetchall()
    col_names = {row[1] for row in cols}
    if "is_validated" not in col_names:
        conn.execute(
            text("ALTER TABLE projects ADD COLUMN is_validated BOOLEAN NOT NULL DEFAULT 0")
        )
    if "group_names" not in col_names:
        conn.execute(text("ALTER TABLE projects ADD COLUMN group_names TEXT NOT NULL DEFAULT ''"))
    if "scope_start_date" not in col_names:
        conn.execute(text("ALTER TABLE projects ADD COLUMN scope_start_date DATE NULL"))
    if "scope_end_date" not in col_names:
        conn.execute(text("ALTER TABLE projects ADD COLUMN scope_end_date DATE NULL"))
    if "market_amount" not in col_names:
        conn.execute(text("ALTER TABLE projects ADD COLUMN market_amount INTEGER NOT NULL DEFAULT 0"))
    scope_cols = conn.execute(text("PRAGMA table_info(scopes)")).fetchall()
    scope_col_names = {row[1] for row in scope_cols}
    if "section_id" not in scope_col_names:
        conn.execute(text("ALTER TABLE scopes ADD COLUMN section_id INTEGER NULL"))
    if "total_masse_salariale_mensuel" not in scope_col_names:
        conn.execute(
            text(
                "ALTER TABLE scopes ADD COLUMN total_masse_salariale_mensuel FLOAT NOT NULL DEFAULT 0"
            )
        )
    if "total_masse_salariale_horaire" not in scope_col_names:
        conn.execute(
            text(
                "ALTER TABLE scopes ADD COLUMN total_masse_salariale_horaire FLOAT NOT NULL DEFAULT 0"
            )
        )
    ligne_cols = conn.execute(text("PRAGMA table_info(lignes_otp)")).fetchall()
    ligne_col_names = {row[1] for row in ligne_cols}
    if "nombre_jours" not in ligne_col_names:
        conn.execute(
            text("ALTER TABLE lignes_otp ADD COLUMN nombre_jours INTEGER NOT NULL DEFAULT 1")
        )
    if "heures_marche" not in ligne_col_names:
        conn.execute(
            text("ALTER TABLE lignes_otp ADD COLUMN heures_marche FLOAT NOT NULL DEFAULT 0")
        )
    if "consommation_l_h" not in ligne_col_names:
        conn.execute(
            text("ALTER TABLE lignes_otp ADD COLUMN consommation_l_h FLOAT NOT NULL DEFAULT 0")
        )
    if "section" not in ligne_col_names:
        conn.execute(
            text("ALTER TABLE lignes_otp ADD COLUMN section TEXT NOT NULL DEFAULT ''")
        )
    detail_cols = conn.execute(text("PRAGMA table_info(details_mensuels)")).fetchall()
    detail_col_names = {row[1] for row in detail_cols}
    if "montant_brut" not in detail_col_names:
        conn.execute(
            text("ALTER TABLE details_mensuels ADD COLUMN montant_brut FLOAT NOT NULL DEFAULT 0")
        )
    if "montant_net" not in detail_col_names:
        conn.execute(
            text("ALTER TABLE details_mensuels ADD COLUMN montant_net FLOAT NOT NULL DEFAULT 0")
        )


def seed_default_catalogue_sections():
    default_sections = [
        "INSTALLATION",
        "HSE",
        "MASSE SALARIALE",
        "MATERIEL",
        "GASOIL",
        "SOUSTRAITANCE",
        "FOURNITURES",
        "AUTRES CHARGES",
    ]
    db = Session(engine)
    try:
        existing = {row[0] for row in db.query(CatalogueSection.nom_section).all()}
        changed = False
        for name in default_sections:
            if name not in existing:
                db.add(CatalogueSection(nom_section=name))
                changed = True
        if changed:
            db.commit()

        sections_by_id = {
            section.id: section.nom_section for section in db.query(CatalogueSection).all()
        }
        for scope in db.query(Scope).all():
            if scope.section_id:
                continue
            first_section = None
            if scope.sections:
                first_section = scope.sections[0]
            if first_section and first_section.catalogue_id in sections_by_id:
                scope.section_id = first_section.catalogue_id
        db.commit()
    finally:
        db.close()


seed_default_catalogue_sections()


def seed_csv_catalogues():
    data_dir = Path(__file__).resolve().parents[1] / "sgtm-frontend" / "public" / "data"
    if not data_dir.exists():
        return

    db = Session(engine)
    try:
        csv_files = sorted(data_dir.glob("*.csv"))
        for csv_file in csv_files:
            with csv_file.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle, delimiter=";")
                headers = list(reader.fieldnames or [])
                rows = [dict(row or {}) for row in reader]

            catalogue = (
                db.query(CsvCatalogue)
                .filter(CsvCatalogue.file_name == csv_file.name)
                .first()
            )
            if not catalogue:
                catalogue = CsvCatalogue(
                    file_name=csv_file.name,
                    display_name=csv_file.stem,
                    delimiter=";",
                    columns_json=json.dumps(headers, ensure_ascii=False),
                    updated_at=datetime.utcnow(),
                )
                db.add(catalogue)
                db.flush()
            else:
                catalogue.display_name = csv_file.stem
                catalogue.delimiter = ";"
                catalogue.columns_json = json.dumps(headers, ensure_ascii=False)
                catalogue.updated_at = datetime.utcnow()
                db.query(CsvCatalogueRow).filter(
                    CsvCatalogueRow.catalogue_id == catalogue.id
                ).delete()
                db.flush()

            for index, row in enumerate(rows, start=1):
                db.add(
                    CsvCatalogueRow(
                        catalogue_id=catalogue.id,
                        row_index=index,
                        row_json=json.dumps(row, ensure_ascii=False),
                    )
                )

        db.commit()
    finally:
        db.close()


seed_csv_catalogues()


def seed_analytics_dimensions():
    db = Session(engine)
    try:
        existing_types = {row[0] for row in db.query(DimCostType.code).all()}
        default_types = [
            ("OTP", "Ligne OTP"),
            ("SALARY", "Masse salariale"),
            ("GASOIL", "Gasoil"),
            ("MATERIAL", "Materiel"),
            ("SUBCONTRACT", "Sous-traitance"),
            ("SUPPLY", "Fournitures"),
            ("OTHER", "Autres charges"),
        ]
        for code, label in default_types:
            if code not in existing_types:
                db.add(DimCostType(code=code, label=label))
        db.commit()

        today = date.today()
        key = date_to_key(today)
        existing_date = db.query(DimDate).filter(DimDate.date_key == key).first()
        if not existing_date:
            db.add(
                DimDate(
                    date_key=key,
                    full_date=today,
                    year=today.year,
                    month=today.month,
                    day=today.day,
                    quarter=((today.month - 1) // 3) + 1,
                )
            )
            db.commit()
    finally:
        db.close()


seed_analytics_dimensions()

#  routes
app.include_router(project_router)
app.include_router(budget_router)

@app.get("/")
def home():
    return {"message": "ERP SGTM API is running ðŸš€"}

