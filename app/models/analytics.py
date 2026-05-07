from datetime import datetime, date

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from app.database import Base


class BudgetVersion(Base):
    __tablename__ = "budget_versions"
    __table_args__ = (
        UniqueConstraint("budget_id", "version_no", name="uq_budget_version_number"),
    )

    id = Column(Integer, primary_key=True, index=True)
    budget_id = Column(Integer, ForeignKey("budgets.id"), nullable=False, index=True)
    version_no = Column(Integer, nullable=False, default=1)
    status = Column(String, nullable=False, default="draft")
    note = Column(String, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class DimDate(Base):
    __tablename__ = "dim_date"

    date_key = Column(Integer, primary_key=True, index=True)  # YYYYMMDD
    full_date = Column(Date, nullable=False, unique=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    day = Column(Integer, nullable=False)
    quarter = Column(Integer, nullable=False)


class DimCostType(Base):
    __tablename__ = "dim_cost_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    label = Column(String, nullable=False, unique=True)


class FactBudgetMonthly(Base):
    __tablename__ = "fact_budget_monthly"
    __table_args__ = (
        UniqueConstraint(
            "date_key",
            "project_id",
            "scope_id",
            "section_id",
            "sous_section_id",
            "line_id",
            "cost_type_id",
            name="uq_fact_budget_monthly_grain",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    date_key = Column(Integer, ForeignKey("dim_date.date_key"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    budget_id = Column(Integer, ForeignKey("budgets.id"), nullable=False, index=True)
    scope_id = Column(Integer, ForeignKey("scopes.id"), nullable=False, index=True)
    section_id = Column(Integer, ForeignKey("sections_budgetaires.id"), nullable=True, index=True)
    sous_section_id = Column(Integer, ForeignKey("sous_sections.id"), nullable=True, index=True)
    line_id = Column(Integer, ForeignKey("lignes_otp.id"), nullable=True, index=True)
    cost_type_id = Column(Integer, ForeignKey("dim_cost_types.id"), nullable=False, index=True)
    quantity = Column(Float, nullable=False, default=0.0)
    unit_price = Column(Float, nullable=False, default=0.0)
    amount = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


def date_to_key(value: date) -> int:
    return int(value.strftime("%Y%m%d"))
