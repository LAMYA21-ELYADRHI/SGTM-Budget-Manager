import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FiCalendar,
  FiChevronDown,
  FiCopy,
  FiDollarSign,
  FiEdit,
  FiEye,
  FiFile,
  FiHash,
  FiLayers,
  FiList,
  FiSearch,
  FiTable,
  FiTrash,
  FiTrendingUp,
} from "react-icons/fi";
import {
  createLigneOtp,
  createSousSection,
  deleteLigneOtp,
  duplicateLigneOtp,
  updateLigneOtp,
} from "../api/api";

const MONTHS = [
  { key: "janvier", month: 1, label: "Janvier" },
  { key: "fevrier", month: 2, label: "Fevrier" },
  { key: "mars", month: 3, label: "Mars" },
  { key: "avril", month: 4, label: "Avril" },
  { key: "mai", month: 5, label: "Mai" },
  { key: "juin", month: 6, label: "Juin" },
  { key: "juillet", month: 7, label: "Juillet" },
  { key: "aout", month: 8, label: "Aout" },
  { key: "septembre", month: 9, label: "Septembre" },
  { key: "octobre", month: 10, label: "Octobre" },
  { key: "novembre", month: 11, label: "Novembre" },
  { key: "decembre", month: 12, label: "Decembre" },
];

const TABLE_COLUMN_WIDTHS = ["16%", "22%", "11%", "10%", "11%", "12%", "10%", "8%"];

const emptyMonthlyQty = () =>
  MONTHS.reduce((acc, month) => {
    acc[month.key] = "";
    return acc;
  }, {});

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s-]+/g, "")
    .toUpperCase();

const parseAmount = (value) => {
  const cleaned = String(value || "").replace(/\s/g, "").replace(",", ".").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseSalaryCatalogueCsv = (csvText) =>
  String(csvText || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      const [rawSubsection = "", rawArticle = "", rawSalary = ""] = line.split(";");
      const subsection = rawSubsection.trim();
      const article = rawArticle.trim();
      if (!subsection || !article) return null;
      return {
        id: `salary-${index + 1}`,
        sousSection: subsection,
        article,
        salaireMensuel: parseAmount(rawSalary),
      };
    })
    .filter(Boolean);

const detailsToMonthlyQty = (details = []) =>
  (Array.isArray(details) ? details : []).reduce((acc, detail) => {
    const month = MONTHS.find((item) => item.month === Number(detail?.mois));
    if (!month) return acc;
    acc[month.key] = String(detail?.quantite ?? "");
    return acc;
  }, emptyMonthlyQty());

const detailsToYearState = (details = []) =>
  (Array.isArray(details) ? details : []).reduce((acc, detail) => {
    const month = MONTHS.find((item) => item.month === Number(detail?.mois));
    const year = Number(detail?.annee);
    if (!month || !year) return acc;
    if (!acc[year]) acc[year] = emptyMonthlyQty();
    acc[year][month.key] = String(detail?.quantite ?? "");
    return acc;
  }, {});

const yearStateToDetails = (yearState = {}) =>
  Object.entries(yearState).flatMap(([year, months]) =>
    MONTHS.filter((month) => Number(months?.[month.key] || 0) > 0).map((month) => ({
      mois: month.month,
      annee: Number(year),
      quantite: Number(months[month.key] || 0),
    }))
  );

const sumMonthlyQty = (monthlyQty = {}) =>
  MONTHS.reduce((sum, month) => sum + Number(monthlyQty?.[month.key] || 0), 0);

const sumYearState = (yearState = {}) =>
  Object.values(yearState).reduce((sum, months) => sum + sumMonthlyQty(months), 0);

const clampMonth = (value) => {
  if (value === "" || value == null) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  if (parsed <= 0) return "0";
  return "1";
};

const findSalarySection = (scope) =>
  (scope?.sections || []).find((section) => normalize(section?.nom) === "MASSESALARIALE") ||
  null;

const isMonthlySalaryLine = (line) => normalize(line?.unite) === "MOIS";

export default function SalarySection({
  activeScope,
  scopeYears,
  ensureActiveSectionInScope,
  refreshBudget,
  activeSectionScopeTotal,
  activeSectionTotal,
  salaryMonthlyScopeTotal,
  lastSavedAt,
  onSave,
  onValidate,
  formatAmount,
}) {
  const [catalogue, setCatalogue] = useState([]);
  const [subsection, setSubsection] = useState("");
  const [subsectionQuery, setSubsectionQuery] = useState("");
  const [subsectionPickerOpen, setSubsectionPickerOpen] = useState(false);
  const [article, setArticle] = useState("");
  const [articleQuery, setArticleQuery] = useState("");
  const [articlePickerOpen, setArticlePickerOpen] = useState(false);
  const [salary, setSalary] = useState("");
  const [effectif, setEffectif] = useState("");
  const [monthlyQtyByYear, setMonthlyQtyByYear] = useState({});
  const [modalDraftByYear, setModalDraftByYear] = useState({});
  const [modalYears, setModalYears] = useState([]);
  const [activeModalYear, setActiveModalYear] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingLine, setEditingLine] = useState(null);
  const [inlineSalaryDrafts, setInlineSalaryDrafts] = useState({});
  const [inlineEffectifDrafts, setInlineEffectifDrafts] = useState({});
  const subsectionWrapRef = useRef(null);
  const articleWrapRef = useRef(null);

  const modalYear = Number(scopeYears?.[0] || new Date().getFullYear());
  const availableYears = scopeYears.length ? scopeYears.map((y) => Number(y)) : [modalYear];
  const modalQty = modalDraftByYear[Number(activeModalYear)] || emptyMonthlyQty();

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${process.env.PUBLIC_URL}/data/Masse-salariale-data.csv`);
        if (!response.ok) throw new Error("Catalogue Masse salariale introuvable.");
        const csvText = await response.text();
        setCatalogue(parseSalaryCatalogueCsv(csvText));
      } catch {
        setCatalogue([]);
      }
    })();
  }, []);

  const sousSections = useMemo(
    () => Array.from(new Set(catalogue.map((item) => item.sousSection))).filter(Boolean),
    [catalogue]
  );

  const filteredSousSections = useMemo(() => {
    const query = String(subsectionQuery || "").trim().toLowerCase();
    if (!query) return sousSections;
    return sousSections.filter((item) => String(item || "").toLowerCase().includes(query));
  }, [sousSections, subsectionQuery]);

  const articles = useMemo(
    () => catalogue.filter((item) => item.sousSection === subsection),
    [catalogue, subsection]
  );

  const filteredArticles = useMemo(() => {
    const query = String(articleQuery || "").trim().toLowerCase();
    if (!query) return articles;
    return articles.filter((item) => String(item.article || "").toLowerCase().includes(query));
  }, [articles, articleQuery]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (subsectionWrapRef.current && !subsectionWrapRef.current.contains(event.target)) {
        setSubsectionPickerOpen(false);
      }
      if (articleWrapRef.current && !articleWrapRef.current.contains(event.target)) {
        setArticlePickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const lines = useMemo(() => {
    const section = findSalarySection(activeScope);
    if (!section) return [];
    const out = [];
    for (const ss of section.sous_sections || []) {
      for (const line of ss.lignes_otp || []) {
        if (!isMonthlySalaryLine(line)) continue;
        const detailQty = detailsToMonthlyQty(line.details_mensuels || []);
        out.push({
          id: line.id,
          subsection: ss.nom,
          article: line.designation,
          salary: Number(line.prix_unitaire || 0),
          effectif: Number(line.quantite_globale || 1),
          nombreMois: sumMonthlyQty(detailQty) || Number(line.nombre_jours || 0),
          total: Number(line.montant_total ?? line.total ?? 0),
          detailsMensuels: line.details_mensuels || [],
        });
      }
    }
    return out.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }, [activeScope]);

  const selectedSalary = parseAmount(salary);
  const selectedEffectif = Number(effectif || 0);
  const totalMois = sumYearState(monthlyQtyByYear);
  const currentTotal = selectedSalary * selectedEffectif * totalMois;

  const modalTotalQty = sumYearState(modalDraftByYear);
  const modalMonthlyAmounts = MONTHS.map((month) => ({
    ...month,
    qty: Number(modalQty?.[month.key] || 0),
    amount: Number(modalQty?.[month.key] || 0) * selectedSalary * selectedEffectif,
  }));
  const modalTotalAmount = modalMonthlyAmounts.reduce((sum, month) => sum + month.amount, 0);

  const resetForm = () => {
    setSubsection("");
    setSubsectionQuery("");
    setArticle("");
    setArticleQuery("");
    setSalary("");
    setEffectif("");
    setMonthlyQtyByYear({ [modalYear]: emptyMonthlyQty() });
    setModalDraftByYear({ [modalYear]: emptyMonthlyQty() });
    setModalYears([modalYear]);
    setActiveModalYear(String(modalYear));
    setEditingLine(null);
    setShowModal(false);
  };

  useEffect(() => {
    if (!Object.keys(monthlyQtyByYear).length) {
      setMonthlyQtyByYear({ [modalYear]: emptyMonthlyQty() });
    }
  }, [modalYear, monthlyQtyByYear]);

  useEffect(() => {
    if (!modalYears.length) {
      setModalYears(availableYears);
      setActiveModalYear(String(availableYears[0]));
      return;
    }
    if (!activeModalYear) {
      setActiveModalYear(String(modalYears[0]));
    }
  }, [availableYears, modalYears, activeModalYear]);

  const selectSubsection = (value) => {
    setSubsection(value);
    setSubsectionQuery(value);
    setSubsectionPickerOpen(false);
    setArticle("");
    setArticleQuery("");
    setSalary("");
    setEffectif("");
  };

  const handleSubsectionQueryChange = (value) => {
    setSubsectionQuery(value);
    setSubsectionPickerOpen(true);
    const exact = sousSections.find((item) => normalize(item) === normalize(value));
    setSubsection(exact || "");
    setArticle("");
    setArticleQuery("");
    setSalary("");
  };

  const selectArticle = (value) => {
    const found = articles.find((item) => item.article === value);
    setArticle(found?.article || "");
    setArticleQuery(found?.article || value);
    setArticlePickerOpen(false);
    setSalary(found ? String(found.salaireMensuel) : "");
  };

  const handleArticleQueryChange = (value) => {
    setArticleQuery(value);
    setArticlePickerOpen(true);
    const found = articles.find((item) => normalize(item.article) === normalize(value));
    setArticle(found?.article || "");
    setSalary(found ? String(found.salaireMensuel) : "");
  };

  const openQuantityModal = (mode, line = null) => {
    setModalMode(mode);
    setEditingLine(line);
    if (line) {
      setSubsection(line.subsection || "");
      setSubsectionQuery(line.subsection || "");
      setArticle(line.article || "");
      setArticleQuery(line.article || "");
      setSalary(String(line.salary || ""));
      setEffectif(String(line.effectif || 1));
      const lineState = detailsToYearState(line.detailsMensuels || []);
      const years = Object.keys(lineState).map((year) => Number(year));
      const nextYears = years.length ? years : availableYears;
      setModalDraftByYear(
        nextYears.reduce((acc, year) => ({ ...acc, [year]: lineState[year] || emptyMonthlyQty() }), {})
      );
      setModalYears(nextYears);
      setActiveModalYear(String(nextYears[0]));
    } else {
      const baseYears = availableYears;
      const merged = baseYears.reduce(
        (acc, year) => ({ ...acc, [year]: monthlyQtyByYear[year] || emptyMonthlyQty() }),
        {}
      );
      setModalDraftByYear(merged);
      setModalYears(baseYears);
      setActiveModalYear(String(baseYears[0]));
    }
    setShowModal(true);
  };

  const buildPayload = (qtyState) => {
    const totalQty = sumYearState(qtyState);
    const monthlySalary = parseAmount(salary);
    const teamEffectif = Number(effectif || 0);
    return {
      code_otp: "-",
      section: "MASSE_SALARIALE",
      designation: article,
      unite: "Mois",
      quantite_globale: teamEffectif,
      prix_unitaire: monthlySalary,
      montant_total: Number((monthlySalary * teamEffectif * totalQty).toFixed(2)),
      nombre_jours: Math.floor(totalQty),
      details_mensuels: yearStateToDetails(qtyState),
    };
  };

  const saveLine = async (qtyState = monthlyQtyByYear, lineId = null) => {
    const cleanSubsection = String(subsection || "").trim();
    const cleanArticle = String(article || "").trim();
    const monthlySalary = parseAmount(salary);
    const teamEffectif = Number(effectif || 0);
    const totalQty = sumYearState(qtyState);
    const catalogueSubsection = sousSections.find((item) => normalize(item) === normalize(cleanSubsection));
    const catalogueArticle = articles.find((item) => normalize(item.article) === normalize(cleanArticle));

    if (!cleanSubsection || !cleanArticle || monthlySalary <= 0 || teamEffectif <= 0) {
      alert("Veuillez choisir la sous-section, l'article, le salaire mensuel et l'effectif.");
      return false;
    }
    if (!catalogueSubsection) {
      alert("Veuillez choisir une sous-section existante de la liste Masse salariale.");
      return false;
    }
    if (!catalogueArticle) {
      alert("Veuillez choisir un article existant de la liste Masse salariale.");
      return false;
    }
    if (totalQty <= 0) {
      alert("Veuillez remplir au moins un mois.");
      return false;
    }
    if (!activeScope) {
      alert("Veuillez sélectionner un scope.");
      return false;
    }

    try {
      const section = await ensureActiveSectionInScope("MASSE_SALARIALE");
      if (!section) {
        alert("Section Masse salariale non disponible pour ce scope.");
        return false;
      }
      let targetSousSection =
        (section.sous_sections || []).find((item) => item.nom === catalogueSubsection) || null;
      if (!targetSousSection) {
        targetSousSection = await createSousSection(section.id, { nom: catalogueSubsection });
      }

      const payload = buildPayload(qtyState);
      if (lineId) {
        await updateLigneOtp(lineId, payload);
      } else {
        await createLigneOtp(targetSousSection.id, payload);
      }
      await refreshBudget();
      resetForm();
      return true;
    } catch (error) {
      alert(error?.message || "Erreur API");
      return false;
    }
  };

  const confirmModal = async () => {
    if (modalTotalQty <= 0) {
      alert("Veuillez remplir au moins un mois.");
      return;
    }
    if (modalMode === "edit" && editingLine?.id) {
      await saveLine(modalDraftByYear, editingLine.id);
      return;
    }
    if (modalMode !== "view") {
      setMonthlyQtyByYear(modalDraftByYear);
    }
    setShowModal(false);
  };

  const addModalYearSlot = () => {
    const currentIndex = modalYears.indexOf(Number(activeModalYear));
    const nextYear = modalYears[currentIndex + 1] || modalYears[modalYears.length - 1] + 1;
    setModalYears((prev) => (prev.includes(nextYear) ? prev : [...prev, nextYear]));
    setModalDraftByYear((prev) => ({
      ...prev,
      [nextYear]: emptyMonthlyQty(),
    }));
    setActiveModalYear(String(nextYear));
  };

  const removeModalYearSlot = () => {
    if (modalYears.length <= 1) return;
    const currentYear = Number(activeModalYear);
    const fallbackYear = modalYears.find((year) => year !== currentYear) || modalYears[0];
    setModalYears((prev) => prev.filter((year) => year !== currentYear));
    setModalDraftByYear((prev) => {
      const next = { ...prev };
      delete next[currentYear];
      return next;
    });
    setActiveModalYear(String(fallbackYear));
  };

  const deleteLine = async (lineId) => {
    const confirmed = window.confirm("Supprimer cette ligne ?");
    if (!confirmed) return;
    try {
      await deleteLigneOtp(lineId);
      await refreshBudget();
    } catch (error) {
      alert(error?.message || "Erreur API");
    }
  };

  const duplicateLine = async (lineId) => {
    try {
      await duplicateLigneOtp(lineId);
      await refreshBudget();
    } catch (error) {
      alert(error?.message || "Erreur API");
    }
  };

  const saveInlineSalary = async (line) => {
    if (!line?.id) return;
    const nextEffectif = parseAmount(inlineEffectifDrafts[line.id] ?? line.effectif);
    const nextSalary = parseAmount(inlineSalaryDrafts[line.id] ?? line.salary);
    if (nextSalary <= 0 || nextEffectif <= 0) {
      alert("Le salaire mensuel et l'effectif doivent etre superieurs a 0.");
      return;
    }

    const qtyState = detailsToYearState(line.detailsMensuels || []);
    const totalQty = sumYearState(qtyState) || Number(line.nombreMois || 0);

    try {
      await updateLigneOtp(line.id, {
        code_otp: "-",
        section: "MASSE_SALARIALE",
        designation: line.article,
        unite: "Mois",
        quantite_globale: nextEffectif,
        prix_unitaire: nextSalary,
        montant_total: Number((nextSalary * nextEffectif * totalQty).toFixed(2)),
        nombre_jours: Math.floor(totalQty),
        details_mensuels: yearStateToDetails(qtyState),
      });
      setInlineEffectifDrafts((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      setInlineSalaryDrafts((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      await refreshBudget();
    } catch (error) {
      alert(error?.message || "Erreur API");
    }
  };

  return (
    <>
      <form
        className="budget-grid budget-form-card"
        onSubmit={(event) => {
          event.preventDefault();
          saveLine(monthlyQtyByYear);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
            event.preventDefault();
          }
        }}
      >
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#1e3a8a",
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          <FiCalendar aria-hidden="true" />
          <span>Mensuel</span>
        </div>
        <div className="budget-form-row budget-form-row-top">
          <div className="budget-field-group budget-field-group-wide">
            <label className="budget-label">Sous-section</label>
            <div className="article-input-wrap" ref={subsectionWrapRef}>
              <input
                type="text"
                value={subsectionQuery}
                onChange={(event) => handleSubsectionQueryChange(event.target.value)}
                onClick={() => setSubsectionPickerOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                placeholder="Rechercher une sous-section"
                aria-label="Rechercher une sous-section"
                aria-autocomplete="list"
              />
              <button
                type="button"
                className="article-filter-btn"
                onClick={() => setSubsectionPickerOpen((prev) => !prev)}
                onMouseDown={(event) => event.preventDefault()}
                aria-label="Afficher les sous-sections"
                title="Afficher les sous-sections"
              >
                {subsectionQuery ? <FiSearch aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
              </button>
              {subsectionPickerOpen && (
                <div className="article-picker">
                  {filteredSousSections.length > 0 ? (
                    filteredSousSections.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="article-picker-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSubsection(item)}
                      >
                        <span>{item}</span>
                      </button>
                    ))
                  ) : (
                    <div className="article-picker-empty">Aucune sous-section existante</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="budget-field-group budget-field-group-wide">
            <label className="budget-label">Fonction</label>
            <div className="article-input-wrap" ref={articleWrapRef}>
              <input
                type="text"
                value={articleQuery}
                onChange={(event) => handleArticleQueryChange(event.target.value)}
                onClick={() => setArticlePickerOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                }}
                placeholder="Rechercher un article"
                aria-label="Rechercher un article"
                aria-autocomplete="list"
                disabled={!subsection}
              />
              <button
                type="button"
                className="article-filter-btn"
                onClick={() => setArticlePickerOpen((prev) => !prev)}
                onMouseDown={(event) => event.preventDefault()}
                aria-label="Afficher les articles"
                title="Afficher les articles"
                disabled={!subsection}
              >
                {articleQuery ? <FiSearch aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
              </button>
              {articlePickerOpen && subsection && (
                <div className="article-picker">
                  {filteredArticles.length > 0 ? (
                    filteredArticles.map((item) => (
                      <button
                        key={`${item.sousSection}-${item.article}`}
                        type="button"
                        className="article-picker-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectArticle(item.article)}
                      >
                        <span>{item.article}</span>
                      </button>
                    ))
                  ) : (
                    <div className="article-picker-empty">Aucun article existant</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="budget-form-row budget-form-row-mid">
          <div className="budget-field-group">
            <label className="budget-label">Salaire mensuel</label>
            <input type="number" min={0} step="0.01" value={salary} onChange={(event) => setSalary(event.target.value)} />
          </div>
          <div className="budget-field-group">
            <label className="budget-label">Effectif</label>
            <input
              type="number"
              min={0}
              step="1"
              value={effectif}
              onChange={(event) => setEffectif(event.target.value)}
            />
          </div>
        </div>

        <div className="budget-details-row">
          <label className="budget-label budget-label-inline">
            <FiTable aria-hidden="true" />
            <span>Détails des mois</span>
          </label>
          <button
            type="button"
            className="btn-sm btn-secondary inline-action-btn"
            onClick={() => openQuantityModal("create")}
          >
            <FiEdit aria-hidden="true" />
            <span>Remplir les mois</span>
          </button>
        </div>

        <div className="budget-summary-bar">
          <div className="budget-summary-item">
            <FiHash aria-hidden="true" />
            <span>Nombre de mois</span>
            <b>{formatAmount(totalMois)}</b>
          </div>
          <div className="budget-summary-item">
            <FiDollarSign aria-hidden="true" />
            <span>Salaire mensuel</span>
            <b>{formatAmount(selectedSalary)} DH</b>
          </div>
          <div className="budget-summary-item">
            <FiTrendingUp aria-hidden="true" />
            <span>MontantTotal</span>
            <b>{formatAmount(currentTotal)} DH</b>
          </div>
        </div>

        <div className="budget-add-row">
          <div className="budget-mini-info" />
          <button type="submit" className="btn-sm add-table-btn">
            Ajouter au tableau
          </button>
        </div>
      </form>

      <div className="budget-table-wrap">
        <div className="budget-section-heading budget-section-heading-table">
          <FiTable aria-hidden="true" />
          <span>Tableau</span>
        </div>
        <table className="table budget-table budget-table-head">
          <colgroup>
            {TABLE_COLUMN_WIDTHS.map((width, index) => (
              <col key={`salary-head-col-${index}`} style={{ width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th>
                <span className="budget-th-label">
                  <FiLayers aria-hidden="true" />
                  <span>Sous-section</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiFile aria-hidden="true" />
                  <span>Fonction</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiDollarSign aria-hidden="true" />
                  <span>Salaire mensuel</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiHash aria-hidden="true" />
                  <span>Effectif</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiHash aria-hidden="true" />
                  <span>Nombre de mois</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiTrendingUp aria-hidden="true" />
                  <span>MontantTotal</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiTable aria-hidden="true" />
                  <span>Détail des montants</span>
                </span>
              </th>
              <th>
                <span className="budget-th-label">
                  <FiList aria-hidden="true" />
                  <span>Action</span>
                </span>
              </th>
            </tr>
          </thead>
        </table>
        <div className="budget-table-scroll">
          <table className="table budget-table budget-table-body">
            <colgroup>
              {TABLE_COLUMN_WIDTHS.map((width, index) => (
                <col key={`salary-body-col-${index}`} style={{ width }} />
              ))}
            </colgroup>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.subsection}</td>
                  <td>{line.article}</td>
                  <td className="table-num-cell">
                    <input
                      className="table-inline-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(inlineSalaryDrafts[line.id] ?? line.salary ?? 0)}
                      onChange={(event) =>
                        setInlineSalaryDrafts((prev) => ({
                          ...prev,
                          [line.id]: event.target.value,
                        }))
                      }
                      onBlur={() => saveInlineSalary(line)}
                    />
                  </td>
                  <td className="table-num-cell">
                    <input
                      className="table-inline-input"
                      type="number"
                      min={0}
                      step="1"
                      value={String(inlineEffectifDrafts[line.id] ?? line.effectif ?? 0)}
                      onChange={(event) =>
                        setInlineEffectifDrafts((prev) => ({
                          ...prev,
                          [line.id]: event.target.value,
                        }))
                      }
                      onBlur={() => saveInlineSalary(line)}
                    />
                  </td>
                  <td className="table-num-cell">{formatAmount(line.nombreMois)}</td>
                  <td>
                    <b>{formatAmount(line.total)}</b>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-sm line-view-btn inline-action-btn"
                      onClick={() => openQuantityModal("view", line)}
                    >
                      <FiEye aria-hidden="true" />
                      <span>Consulter le détail</span>
                    </button>
                  </td>
                  <td>
                    <div className="line-action-group">
                      <button
                        type="button"
                        className="line-action-btn line-edit-btn"
                        onClick={() => openQuantityModal("edit", line)}
                        title="Modifier la ligne"
                        aria-label="Modifier la ligne"
                      >
                        <FiEdit aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="line-action-btn line-duplicate-btn"
                        onClick={() => duplicateLine(line.id)}
                        title="Dupliquer la ligne"
                        aria-label="Dupliquer la ligne"
                      >
                        <FiCopy aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="line-action-btn line-delete-btn"
                        onClick={() => deleteLine(line.id)}
                        title="Supprimer la ligne"
                        aria-label="Supprimer la ligne"
                      >
                        <FiTrash aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={8}>Aucune ligne pour ce scope/section.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="budget-footer">
        <div className="budget-footer-left">
          <div className="budget-saved">
            Dernière sauvegarde: <b>{lastSavedAt || "-"}</b>
          </div>
        </div>
        <div className="budget-footer-center">
          <div>
            <b>Total scope :</b> {formatAmount(activeSectionScopeTotal)} DH
          </div>
          <div>
            <b>Total section :</b> {formatAmount(activeSectionTotal)} DH
          </div>
          <div>
            <b>Total masse salariale mensuel :</b> {formatAmount(salaryMonthlyScopeTotal)} DH
          </div>
        </div>
        <div className="budget-footer-right">
          <button type="button" className="btn-sm btn-secondary" onClick={onSave}>
            Enregistrer
          </button>{" "}
          <button type="button" className="btn-sm" onClick={onValidate}>
            Valider
          </button>
        </div>
      </div>

      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 15, 43, 0.58)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(1040px, 96vw)",
              background: "linear-gradient(180deg, #eff5ff 0%, #ffffff 100%)",
              borderRadius: 20,
              border: "1px solid #dbe7fb",
              boxShadow: "0 24px 60px rgba(8, 15, 43, 0.28)",
              padding: 20,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  border: "1px solid #dbe7fb",
                  padding: 14,
                  color: "var(--text-main)",
                  minHeight: 560,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h4
                  style={{
                    marginTop: 0,
                    textAlign: "center",
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--primary-dark)",
                  }}
                >
                  {modalMode === "view" ? "Consulter les mois" : "Remplir les mois"}
                </h4>
                <div className="gasoil-modal-year-switch" style={{ marginBottom: 10 }}>
                  {modalMode !== "view" && (
                    <button type="button" className="btn-sm btn-secondary" onClick={removeModalYearSlot}>
                      - Année
                    </button>
                  )}
                  {modalYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      className={`btn-sm ${String(activeModalYear) === String(year) ? "" : "btn-secondary"}`}
                      onClick={() => setActiveModalYear(String(year))}
                    >
                      {year}
                    </button>
                  ))}
                  {modalMode !== "view" && (
                    <button type="button" className="btn-sm btn-secondary" onClick={addModalYearSlot}>
                      + Année
                    </button>
                  )}
                </div>
                <table className="table" style={{ background: "#fff", borderRadius: 8, overflow: "hidden", flex: 1 }}>
                  <tbody>
                    {[0, 1, 2].map((rowIdx) => {
                      const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                      return (
                        <React.Fragment key={`salary-qty-row-${rowIdx}`}>
                          <tr>
                            {rowMonths.map((month) => (
                              <th key={`salary-qty-head-${month.key}`}>{month.label}</th>
                            ))}
                          </tr>
                          <tr>
                            {rowMonths.map((month) => (
                              <td key={`salary-qty-cell-${month.key}`}>
                                {modalMode === "view" ? (
                                  formatAmount(modalQty[month.key])
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    max={1}
                                    step="1"
                                    value={modalQty[month.key]}
                                    onChange={(event) =>
                                      setModalDraftByYear((prev) => ({
                                        ...prev,
                                        [Number(activeModalYear)]: {
                                          ...(prev[Number(activeModalYear)] || emptyMonthlyQty()),
                                          [month.key]: clampMonth(event.target.value),
                                        },
                                      }))
                                    }
                                    style={{ width: 72 }}
                                  />
                                )}
                              </td>
                            ))}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div className="budget-modal-total-pill">
                  <span className="gasoil-modal-emphasis-label">Total des mois:</span>{" "}
                  <b className="gasoil-modal-emphasis-value">{formatAmount(modalTotalQty)}</b>
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  border: "1px solid #dbe7fb",
                  padding: 14,
                  color: "var(--text-main)",
                  minHeight: 560,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <h4
                  style={{
                    marginTop: 0,
                    textAlign: "center",
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--primary-dark)",
                  }}
                >
                  Détails des montants
                </h4>
                <table className="table" style={{ background: "#fff", borderRadius: 8, overflow: "hidden", flex: 1 }}>
                  <tbody>
                    {[0, 1, 2].map((rowIdx) => {
                      const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                      return (
                        <React.Fragment key={`salary-amount-row-${rowIdx}`}>
                          <tr>
                            {rowMonths.map((month) => (
                              <th key={`salary-amount-head-${month.key}`}>{month.label}</th>
                            ))}
                          </tr>
                          <tr>
                            {rowMonths.map((month) => {
                              const amount =
                                modalMonthlyAmounts.find((item) => item.key === month.key)?.amount || 0;
                              return <td key={`salary-amount-cell-${month.key}`}>{formatAmount(amount)}</td>;
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div className="budget-modal-total-pill budget-modal-total-pill-amount">
                  <span className="gasoil-modal-emphasis-label">Total montants:</span>{" "}
                  <b className="gasoil-modal-emphasis-value">{formatAmount(modalTotalAmount)} DH</b>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              {modalMode === "view" ? (
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => {
                    setShowModal(false);
                    setEditingLine(null);
                  }}
                >
                  Fermer
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-sm btn-secondary"
                    onClick={() => {
                      setShowModal(false);
                      setEditingLine(null);
                    }}
                  >
                    Annuler
                  </button>
                  <button type="button" className="btn-sm" onClick={confirmModal}>
                    Valider
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
