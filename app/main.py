from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.models.project import Project
from app.routes.project import router as project_router
from app.routes.budget import router as budget_router
from sqlalchemy import text
from app.models import budget  # important pour créer tables
from app.models.budget import CatalogueSection, Scope
from sqlalchemy.orm import Session

app = FastAPI()

# Autoriser le frontend React (CRA) en dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#  créer les tables dans SQLite
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

#  routes
app.include_router(project_router)
app.include_router(budget_router)

@app.get("/")
def home():
    return {"message": "ERP SGTM API is running 🚀"}
