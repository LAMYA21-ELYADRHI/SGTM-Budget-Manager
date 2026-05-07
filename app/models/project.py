from sqlalchemy import Column, Integer, String, Float, Date, Boolean
from sqlalchemy.orm import relationship
from app.database import Base

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)

    code = Column(String)                 # Code projet
    name = Column(String)                 # Nom projet
    client = Column(String)               # Client
    pole = Column(String)                 # Pôle
    location = Column(String)             # Localisation

    project_manager = Column(String)      # Directeur projet

    start_date = Column(Date)             # Date début
    end_date = Column(Date)               # Date fin

    is_group = Column(Boolean)            # Groupement oui/non
    is_validated = Column(Boolean, default=False, nullable=False)  # Validé ou non
    group_names = Column(String, default="")  # JSON (liste des noms de groupement)
    scope = Column(String)                # Scopes

    project_type = Column(String)         # Type projet
    market_amount = Column(Integer, default=0)  # Montant de marché
    scope_date = Column(Date)             # (legacy) Date scope
    scope_start_date = Column(Date, nullable=True)  # Date début scope
    scope_end_date = Column(Date, nullable=True)    # Date fin scope
    
    budgets = relationship("Budget", back_populates="projet")