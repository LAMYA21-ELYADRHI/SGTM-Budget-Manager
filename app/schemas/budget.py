from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


# ==========================================
# DETAIL MENSUEL
# ==========================================
class DetailMensuelBase(BaseModel):
    mois: int
    annee: int
    quantite: float


class DetailMensuelCreate(DetailMensuelBase):
    pass


class DetailMensuelResponse(DetailMensuelBase):
    id: int

    class Config:
        from_attributes = True


# ==========================================
# LIGNE OTP
# ==========================================
class LigneOTPBase(BaseModel):
    code_otp: str
    designation: str
    unite: str
    nombre_jours: int = 1
    quantite_globale: float
    prix_unitaire: float
    montant_total: float


class LigneOTPCreate(LigneOTPBase):
    details_mensuels: List[DetailMensuelCreate] = []


class LigneOTPResponse(LigneOTPBase):
    id: int
    details_mensuels: List[DetailMensuelResponse]

    class Config:
        from_attributes = True


# ==========================================
# SOUS SECTION
# ==========================================
class SousSectionBase(BaseModel):
    nom: str
    total_sous_section: float = 0.0


class SousSectionCreate(SousSectionBase):
    lignes_otp: List[LigneOTPCreate] = []


class SousSectionResponse(SousSectionBase):
    id: int
    lignes_otp: List[LigneOTPResponse]

    class Config:
        from_attributes = True


# ==========================================
# SECTION
# ==========================================
class SectionBudgetaireBase(BaseModel):
    nom: str
    total_section: float = 0.0


class SectionBudgetaireCreate(SectionBudgetaireBase):
    sous_sections: List[SousSectionCreate] = []


class SectionBudgetaireResponse(SectionBudgetaireBase):
    id: int
    sous_sections: List[SousSectionResponse]

    class Config:
        from_attributes = True


# ==========================================
# SCOPE
# ==========================================
class ScopeBase(BaseModel):
    nom: str
    total_scope: float = 0.0
    section_id: Optional[int] = None


class ScopeCreate(ScopeBase):
    sections: List[SectionBudgetaireCreate] = []


class ScopeResponse(ScopeBase):
    id: int
    sections: List[SectionBudgetaireResponse]

    class Config:
        from_attributes = True


# ==========================================
# BUDGET
# ==========================================
class BudgetBase(BaseModel):
    statut: Optional[str] = "BROUILLON"
    total_global: Optional[float] = 0.0
    projet_id: int


class BudgetCreate(BudgetBase):
    scopes: List[ScopeCreate] = []


class BudgetResponse(BudgetBase):
    id: int
    date_creation: datetime
    scopes: List[ScopeResponse]

    class Config:
        from_attributes = True


# ==========================================
# CATALOGUE (référentiel cascade)
# ==========================================
class CatalogueSectionCreate(BaseModel):
    nom_section: str


class CatalogueSectionResponse(BaseModel):
    id: int
    nom_section: str

    class Config:
        from_attributes = True


class CatalogueSousSectionCreate(BaseModel):
    nom_sous_section: str
    section_id: int


class CatalogueSousSectionResponse(BaseModel):
    id: int
    nom_sous_section: str
    section_id: int

    class Config:
        from_attributes = True


class CatalogueOTPCreate(BaseModel):
    code_otp: str
    designation: str
    unite: str
    prix_unitaire_reference: float = 0.0
    sous_section_id: int


class CatalogueOTPResponse(BaseModel):
    id: int
    code_otp: str
    designation: str
    unite: str
    prix_unitaire_reference: float
    sous_section_id: int

    class Config:
        from_attributes = True


# ==========================================
# Import catalogue (sections -> sous-sections -> otps)
# ==========================================
class CatalogueImportOTP(BaseModel):
    code_otp: str
    designation: str
    unite: str
    prix_unitaire_reference: float = 0.0


class CatalogueImportSousSection(BaseModel):
    nom_sous_section: str
    otps: List[CatalogueImportOTP] = []


class CatalogueImportSection(BaseModel):
    nom_section: str
    sous_sections: List[CatalogueImportSousSection] = []


class CatalogueImportPayload(BaseModel):
    sections: List[CatalogueImportSection]


# ==========================================
# Affichage scopes (sidebar) + sections affectées
# ==========================================
class ScopeAffichage(BaseModel):
    id: int
    nom: str
    catalogue_ids: List[int]
