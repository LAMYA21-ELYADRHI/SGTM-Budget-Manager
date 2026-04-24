from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime

from app.database import Base


# ==========================================
# 1. BUDGET GLOBAL
# ==========================================
class Budget(Base):
    __tablename__ = "budgets"
    
    id = Column(Integer, primary_key=True, index=True)
    date_creation = Column(DateTime, default=datetime.utcnow)
    statut = Column(String, default="BROUILLON")
    total_global = Column(Float, default=0.0)
    
    projet_id = Column(Integer, ForeignKey("projects.id"))  # ⚠️ adapte au nom de ta table projet
    projet = relationship("Project", back_populates="budgets")
    
    scopes = relationship("Scope", back_populates="budget", cascade="all, delete-orphan")


# ==========================================
# 2. STRUCTURE DU BUDGET
# ==========================================
class Scope(Base):
    __tablename__ = "scopes"
    
    id = Column(Integer, primary_key=True, index=True)
    nom = Column(String)
    total_scope = Column(Float, default=0.0)

    budget_id = Column(Integer, ForeignKey("budgets.id"))
    budget = relationship("Budget", back_populates="scopes")
    section_id = Column(Integer, ForeignKey("catalogue_sections.id"), nullable=True)
    section = relationship("CatalogueSection", back_populates="scopes")

    sections = relationship("SectionBudgetaire", back_populates="scope", cascade="all, delete-orphan")


class SectionBudgetaire(Base):
    __tablename__ = "sections_budgetaires"
    
    id = Column(Integer, primary_key=True, index=True)
    nom = Column(String)
    total_section = Column(Float, default=0.0)
    
    scope_id = Column(Integer, ForeignKey("scopes.id"))
    scope = relationship("Scope", back_populates="sections")
    
    catalogue_id = Column(Integer, ForeignKey("catalogue_sections.id"))
    
    sous_sections = relationship("SousSection", back_populates="section", cascade="all, delete-orphan")


class SousSection(Base):
    __tablename__ = "sous_sections"
    
    id = Column(Integer, primary_key=True, index=True)
    nom = Column(String)
    total_sous_section = Column(Float, default=0.0)
    
    section_id = Column(Integer, ForeignKey("sections_budgetaires.id"))
    section = relationship("SectionBudgetaire", back_populates="sous_sections")
    
    lignes_otp = relationship("LigneOTP", back_populates="sous_section", cascade="all, delete-orphan")


# ==========================================
# 3. LIGNES OTP
# ==========================================
class LigneOTP(Base):
    __tablename__ = "lignes_otp"
    
    id = Column(Integer, primary_key=True, index=True)
    code_otp = Column(String, index=True)
    designation = Column(String)
    unite = Column(String)
    nombre_jours = Column(Integer, default=1)
    quantite_globale = Column(Float, default=0.0)
    prix_unitaire = Column(Float, default=0.0)
    montant_total = Column(Float, default=0.0)
    heures_marche = Column(Float, default=0.0)
    consommation_l_h = Column(Float, default=0.0)
    
    sous_section_id = Column(Integer, ForeignKey("sous_sections.id"))
    sous_section = relationship("SousSection", back_populates="lignes_otp")
    
    details_mensuels = relationship("DetailMensuel", back_populates="ligne_otp", cascade="all, delete-orphan")


class DetailMensuel(Base):
    __tablename__ = "details_mensuels"
    
    id = Column(Integer, primary_key=True, index=True)
    mois = Column(Integer)
    annee = Column(Integer)
    quantite = Column(Float, default=0.0)
    
    ligne_otp_id = Column(Integer, ForeignKey("lignes_otp.id"))
    ligne_otp = relationship("LigneOTP", back_populates="details_mensuels")


# ==========================================
# 4. CATALOGUE
# ==========================================
class CatalogueSection(Base):
    __tablename__ = "catalogue_sections"
    
    id = Column(Integer, primary_key=True, index=True)
    nom_section = Column(String, unique=True)
    scopes = relationship("Scope", back_populates="section")

    sous_sections = relationship("CatalogueSousSection", back_populates="section", cascade="all, delete-orphan")


class CatalogueSousSection(Base):
    __tablename__ = "catalogue_sous_sections"
    
    id = Column(Integer, primary_key=True, index=True)
    nom_sous_section = Column(String)
    
    section_id = Column(Integer, ForeignKey("catalogue_sections.id"))
    section = relationship("CatalogueSection", back_populates="sous_sections")
    
    otps = relationship("CatalogueOTP", back_populates="sous_section", cascade="all, delete-orphan")


class CatalogueOTP(Base):
    __tablename__ = "catalogue_otps"
    
    id = Column(Integer, primary_key=True, index=True)
    code_otp = Column(String, unique=True, index=True)
    designation = Column(String)
    unite = Column(String)
    prix_unitaire_reference = Column(Float, default=0.0)
    
    sous_section_id = Column(Integer, ForeignKey("catalogue_sous_sections.id"))
    sous_section = relationship("CatalogueSousSection", back_populates="otps")
