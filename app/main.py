from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.models.project import Project
from app.routes.project import router as project_router
from app.routes.budget import router as budget_router
from sqlalchemy import text
from app.models import budget  # important pour créer tables

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

#  routes
app.include_router(project_router)
app.include_router(budget_router)

@app.get("/")
def home():
    return {"message": "ERP SGTM API is running 🚀"}