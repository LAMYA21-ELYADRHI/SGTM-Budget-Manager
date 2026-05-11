import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FiChevronDown,
  FiClock,
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

const TABLE_COLUMN_WIDTHS = ["14%", "20%", "9%", "9%", "9%", "9%", "10%", "12%", "8%"];

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
      const [rawSubsection = "", rawFunction = "", rawHoursPerDay = "", rawHourlyPrice = ""] =
        line.split(";");
      const subsection = rawSubsection.trim();
      const fonction = rawFunction.trim();
      if (!subsection || !fonction) return null;
      return {
        id: `salary-h-${index + 1}`,
        sousSection: subsection,
        fonction,
        nombreHeures: parseAmount(rawHoursPerDay),
        prixHoraire: parseAmount(rawHourlyPrice),
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

const clampDayValue = (value) => {
  if (value === "" || value == null) return "";
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return "";
  return String(Math.min(31, Math.max(0, parsed)));
};

const findSalarySection = (scope) =>
  (scope?.sections || []).find((section) => normalize(section?.nom) === "MASSESALARIALE") ||
  null;

const isHourlySalaryLine = (line) => normalize(line?.unite) === "JOUR";

export default function SalarySectionHoraire({
  activeScope,
  scopeYears,
  ensureActiveSectionInScope,
  refreshBudget,
  activeSectionScopeTotal,
  activeSectionTotal,
  salaryHourlyScopeTotal,
  lastSavedAt,
  onSave,
  onValidate,
  formatAmount,
}) {
  const [catalogue, setCatalogue] = useState([]);
  const [subsection, setSubsection] = useState("");
  const [subsectionQuery, setSubsectionQuery] = useState("");
  const [subsectionPickerOpen, setSubsectionPickerOpen] = useState(false);
  const [fonction, setFonction] = useState("");
  const [fonctionQuery, setFonctionQuery] = useState("");
  const [fonctionPickerOpen, setFonctionPickerOpen] = useState(false);
  const [hourlyPrice, setHourlyPrice] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [effectif, setEffectif] = useState("");
  const [monthlyQtyByYear, setMonthlyQtyByYear] = useState({});
  const [modalDraftByYear, setModalDraftByYear] = useState({});
  const [modalYears, setModalYears] = useState([]);
  const [activeModalYear, setActiveModalYear] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingLine, setEditingLine] = useState(null);
  const [inlineHourlyPriceDrafts, setInlineHourlyPriceDrafts] = useState({});
  const [inlineHoursPerDayDrafts, setInlineHoursPerDayDrafts] = useState({});
  const [inlineEffectifDrafts, setInlineEffectifDrafts] = useState({});
  const subsectionWrapRef = useRef(null);
  const fonctionWrapRef = useRef(null);
  const modalYear = Number(scopeYears?.[0] || new Date().getFullYear());
  const availableYears = scopeYears.length ? scopeYears.map((y) => Number(y)) : [modalYear];
  const modalQty = modalDraftByYear[Number(activeModalYear)] || emptyMonthlyQty();

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${process.env.PUBLIC_URL}/data/Masse Salariale Horaire.csv`);
        if (!response.ok) throw new Error("Catalogue Masse salariale horaire introuvable.");
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

  const fonctions = useMemo(
    () => catalogue.filter((item) => item.sousSection === subsection),
    [catalogue, subsection]
  );

  const filteredFonctions = useMemo(() => {
    const query = String(fonctionQuery || "").trim().toLowerCase();
    if (!query) return fonctions;
    return fonctions.filter((item) => String(item.fonction || "").toLowerCase().includes(query));
  }, [fonctions, fonctionQuery]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (subsectionWrapRef.current && !subsectionWrapRef.current.contains(event.target)) {
        setSubsectionPickerOpen(false);
      }
      if (fonctionWrapRef.current && !fonctionWrapRef.current.contains(event.target)) {
        setFonctionPickerOpen(false);
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
        if (!isHourlySalaryLine(line)) continue;
        const detailQty = detailsToMonthlyQty(line.details_mensuels || []);
        const catalogueEntry = catalogue.find(
          (item) =>
            normalize(item.sousSection) === normalize(ss.nom) &&
            normalize(item.fonction) === normalize(line.designation)
        );
        const rowHoursPerDay = Number(catalogueEntry?.nombreHeures || 0);
        const rowHourlyPrice = Number(line.prix_unitaire || catalogueEntry?.prixHoraire || 0);
        const rowEffectif = Number(line.quantite_globale || 1);
        const rowDays = sumMonthlyQty(detailQty) || Number(line.nombre_jours || 0);
        out.push({
          id: line.id,
          subsection: ss.nom,
          fonction: line.designation,
          hourlyPrice: rowHourlyPrice,
          hoursPerDay: rowHoursPerDay,
          effectif: rowEffectif,
          nombreJours: rowDays,
          total: Number(line.montant_total ?? line.total ?? 0),
          detailsMensuels: line.details_mensuels || [],
        });
      }
    }
    return out.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }, [activeScope, catalogue]);

  const selectedHourlyPrice = parseAmount(hourlyPrice);
  const selectedHoursPerDay = parseAmount(hoursPerDay);
  const selectedEffectif = Number(effectif || 0);
  const totalDays = sumYearState(monthlyQtyByYear);
  const currentTotal = selectedHourlyPrice * selectedEffectif * selectedHoursPerDay * totalDays;

  const modalTotalQty = sumYearState(modalDraftByYear);
  const modalMonthlyAmounts = MONTHS.map((month) => ({
    ...month,
    qty: Number(modalQty?.[month.key] || 0),
    amount:
      Number(modalQty?.[month.key] || 0) *
      selectedHourlyPrice *
      selectedEffectif *
      selectedHoursPerDay,
  }));
  const modalTotalAmount = modalMonthlyAmounts.reduce((sum, month) => sum + month.amount, 0);

  const resetForm = () => {
    setSubsection("");
    setSubsectionQuery("");
    setFonction("");
    setFonctionQuery("");
    setHourlyPrice("");
    setHoursPerDay("");
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
    setFonction("");
    setFonctionQuery("");
    setHourlyPrice("");
    setHoursPerDay("");
    setEffectif("");
  };

  const handleSubsectionQueryChange = (value) => {
    setSubsectionQuery(value);
    setSubsectionPickerOpen(true);
    const exact = sousSections.find((item) => normalize(item) === normalize(value));
    setSubsection(exact || "");
    setFonction("");
    setFonctionQuery("");
    setHourlyPrice("");
    setHoursPerDay("");
  };

  const selectFonction = (value) => {
    const found = fonctions.find((item) => item.fonction === value);
    setFonction(found?.fonction || "");
    setFonctionQuery(found?.fonction || value);
    setFonctionPickerOpen(false);
    setHourlyPrice(found ? String(found.prixHoraire) : "");
    setHoursPerDay(found ? String(found.nombreHeures) : "");
  };

  const handleFonctionQueryChange = (value) => {
    setFonctionQuery(value);
    setFonctionPickerOpen(true);
    const found = fonctions.find((item) => normalize(item.fonction) === normalize(value));
    setFonction(found?.fonction || "");
    setHourlyPrice(found ? String(found.prixHoraire) : "");
    setHoursPerDay(found ? String(found.nombreHeures) : "");
  };

  const openQuantityModal = (mode, line = null) => {
    setModalMode(mode);
    setEditingLine(line);
    if (line) {
      setSubsection(line.subsection || "");
      setSubsectionQuery(line.subsection || "");
      setFonction(line.fonction || "");
      setFonctionQuery(line.fonction || "");
      setHourlyPrice(String(line.hourlyPrice || ""));
      setHoursPerDay(String(line.hoursPerDay || ""));
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
    const price = parseAmount(hourlyPrice);
    const hours = parseAmount(hoursPerDay);
    const teamEffectif = Number(effectif || 0);
    return {
      code_otp: "-",
      section: "MASSE_SALARIALE",
      designation: fonction,
      unite: "Jour",
      quantite_globale: teamEffectif,
      prix_unitaire: price,
      montant_total: Number((price * teamEffectif * hours * totalQty).toFixed(2)),
      nombre_jours: Math.floor(totalQty),
      details_mensuels: yearStateToDetails(qtyState),
    };
  };

  const saveLine = async (qtyState = monthlyQtyByYear, lineId = null) => {
    const cleanSubsection = String(subsection || "").trim();
    const cleanFonction = String(fonction || "").trim();
    const price = parseAmount(hourlyPrice);
    const hours = parseAmount(hoursPerDay);
    const teamEffectif = Number(effectif || 0);
    const totalQty = sumYearState(qtyState);
    const catalogueSubsection = sousSections.find((item) => normalize(item) === normalize(cleanSubsection));
    const catalogueFonction = fonctions.find((item) => normalize(item.fonction) === normalize(cleanFonction));

    if (!cleanSubsection || !cleanFonction || price <= 0 || hours <= 0 || teamEffectif <= 0) {
      alert("Veuillez choisir sous-section/fonction et saisir un effectif valide.");
      return false;
    }
    if (!catalogueSubsection) {
      alert("Veuillez choisir une sous-section existante.");
      return false;
    }
    if (!catalogueFonction) {
      alert("Veuillez choisir une fonction existante.");
      return false;
    }
    if (totalQty <= 0) {
      alert("Veuillez remplir au moins un jour.");
      return false;
    }
    if (!activeScope) {
      alert("Veuillez selectionner un scope.");
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
      alert("Veuillez remplir au moins un jour.");
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

  const saveInlineHourlyFields = async (line) => {
    if (!line?.id) return;
    const nextEffectif = parseAmount(inlineEffectifDrafts[line.id] ?? line.effectif);
    const nextHourlyPrice = parseAmount(inlineHourlyPriceDrafts[line.id] ?? line.hourlyPrice);
    const nextHoursPerDay = parseAmount(inlineHoursPerDayDrafts[line.id] ?? line.hoursPerDay);
    if (nextEffectif <= 0 || nextHourlyPrice <= 0 || nextHoursPerDay <= 0) {
      alert("Effectif, Prix H/J et Nombre heures doivent etre superieurs a 0.");
      return;
    }

    const qtyState = detailsToYearState(line.detailsMensuels || []);
    const totalQty = sumYearState(qtyState) || Number(line.nombreJours || 0);

    try {
      await updateLigneOtp(line.id, {
        code_otp: "-",
        section: "MASSE_SALARIALE",
        designation: line.fonction,
        unite: "Jour",
        quantite_globale: nextEffectif,
        prix_unitaire: nextHourlyPrice,
        montant_total: Number((nextHourlyPrice * nextEffectif * nextHoursPerDay * totalQty).toFixed(2)),
        nombre_jours: Math.floor(totalQty),
        details_mensuels: yearStateToDetails(qtyState),
      });
      setInlineEffectifDrafts((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      setInlineHourlyPriceDrafts((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      setInlineHoursPerDayDrafts((prev) => {
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
          <FiClock aria-hidden="true" />
          <span>Horaire</span>
        </div>
        <div className="budget-form-row budget-form-row-top">
          <div className="budget-field-group budget-field-group-wide">
            <label className="budget-label">Sous-section</label>
            <div className="article-input-wrap" ref={subsectionWrapRef}>
              <input type="text" value={subsectionQuery} onChange={(event) => handleSubsectionQueryChange(event.target.value)} onClick={() => setSubsectionPickerOpen(true)} placeholder="Rechercher une sous-section" aria-label="Rechercher une sous-section" aria-autocomplete="list" />
              <button type="button" className="article-filter-btn" onClick={() => setSubsectionPickerOpen((prev) => !prev)} onMouseDown={(event) => event.preventDefault()} aria-label="Afficher les sous-sections" title="Afficher les sous-sections">
                {subsectionQuery ? <FiSearch aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
              </button>
              {subsectionPickerOpen && (
                <div className="article-picker">
                  {filteredSousSections.length > 0 ? filteredSousSections.map((item) => (
                    <button key={item} type="button" className="article-picker-item" onMouseDown={(event) => event.preventDefault()} onClick={() => selectSubsection(item)}>
                      <span>{item}</span>
                    </button>
                  )) : <div className="article-picker-empty">Aucune sous-section existante</div>}
                </div>
              )}
            </div>
          </div>
          <div className="budget-field-group budget-field-group-wide">
            <label className="budget-label">Fonction</label>
            <div className="article-input-wrap" ref={fonctionWrapRef}>
              <input type="text" value={fonctionQuery} onChange={(event) => handleFonctionQueryChange(event.target.value)} onClick={() => setFonctionPickerOpen(true)} placeholder="Rechercher une fonction" aria-label="Rechercher une fonction" aria-autocomplete="list" disabled={!subsection} />
              <button type="button" className="article-filter-btn" onClick={() => setFonctionPickerOpen((prev) => !prev)} onMouseDown={(event) => event.preventDefault()} aria-label="Afficher les fonctions" title="Afficher les fonctions" disabled={!subsection}>
                {fonctionQuery ? <FiSearch aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
              </button>
              {fonctionPickerOpen && subsection && (
                <div className="article-picker">
                  {filteredFonctions.length > 0 ? filteredFonctions.map((item) => (
                    <button key={`${item.sousSection}-${item.fonction}`} type="button" className="article-picker-item" onMouseDown={(event) => event.preventDefault()} onClick={() => selectFonction(item.fonction)}>
                      <span>{item.fonction}</span>
                    </button>
                  )) : <div className="article-picker-empty">Aucune fonction existante</div>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="budget-form-row budget-form-row-mid">
          <div className="budget-field-group">
            <label className="budget-label">Prix H/J</label>
            <input type="number" min={0} step="0.01" value={hourlyPrice} onChange={(event) => setHourlyPrice(event.target.value)} />
          </div>
          <div className="budget-field-group">
            <label className="budget-label">Nombre heures</label>
            <input type="number" min={0} step="0.01" value={hoursPerDay} onChange={(event) => setHoursPerDay(event.target.value)} />
          </div>
          <div className="budget-field-group">
            <label className="budget-label">Effectif</label>
            <input type="number" min={0} step="1" value={effectif} onChange={(event) => setEffectif(event.target.value)} />
          </div>
        </div>

        <div className="budget-details-row">
          <label className="budget-label budget-label-inline">
            <FiTable aria-hidden="true" />
            <span>Details des jours/montants</span>
          </label>
          <button type="button" className="btn-sm btn-secondary inline-action-btn" onClick={() => openQuantityModal("create")}>
            <FiEdit aria-hidden="true" />
            <span>Remplir les jours</span>
          </button>
        </div>

        <div className="budget-summary-bar">
          <div className="budget-summary-item"><FiHash aria-hidden="true" /><span>Nbr jours</span><b>{formatAmount(totalDays)}</b></div>
          <div className="budget-summary-item"><FiDollarSign aria-hidden="true" /><span>Prix H/J</span><b>{formatAmount(selectedHourlyPrice)} DH</b></div>
          <div className="budget-summary-item"><FiTrendingUp aria-hidden="true" /><span>MontantTotal</span><b>{formatAmount(currentTotal)} DH</b></div>
        </div>

        <div className="budget-add-row">
          <div className="budget-mini-info" />
          <button type="submit" className="btn-sm add-table-btn">Ajouter au tableau</button>
        </div>
      </form>

      <div className="budget-table-wrap">
        <div className="budget-section-heading budget-section-heading-table"><FiTable aria-hidden="true" /><span>Tableau</span></div>
        <table className="table budget-table budget-table-head">
          <colgroup>{TABLE_COLUMN_WIDTHS.map((width, index) => <col key={`salary-h-head-col-${index}`} style={{ width }} />)}</colgroup>
          <thead>
            <tr>
              <th><span className="budget-th-label"><FiLayers aria-hidden="true" /><span>Sous-section</span></span></th>
              <th><span className="budget-th-label"><FiFile aria-hidden="true" /><span>Fonction</span></span></th>
              <th><span className="budget-th-label"><FiHash aria-hidden="true" /><span>Effectif</span></span></th>
              <th><span className="budget-th-label"><FiDollarSign aria-hidden="true" /><span>Prix H/J</span></span></th>
              <th><span className="budget-th-label"><FiHash aria-hidden="true" /><span>Nbr Heures</span></span></th>
              <th><span className="budget-th-label"><FiHash aria-hidden="true" /><span>Nbr jours</span></span></th>
              <th><span className="budget-th-label"><FiTrendingUp aria-hidden="true" /><span>MontantTotal</span></span></th>
              <th><span className="budget-th-label"><FiTable aria-hidden="true" /><span>Detail montants</span></span></th>
              <th><span className="budget-th-label"><FiList aria-hidden="true" /><span>Action</span></span></th>
            </tr>
          </thead>
        </table>
        <div className="budget-table-scroll">
          <table className="table budget-table budget-table-body">
            <colgroup>{TABLE_COLUMN_WIDTHS.map((width, index) => <col key={`salary-h-body-col-${index}`} style={{ width }} />)}</colgroup>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.subsection}</td>
                  <td>{line.fonction}</td>
                  <td className="table-num-cell">
                    <input
                      className="table-inline-input"
                      type="number"
                      min={0}
                      max={31}
                      step="1"
                      value={String(inlineEffectifDrafts[line.id] ?? line.effectif ?? 0)}
                      onChange={(event) =>
                        setInlineEffectifDrafts((prev) => ({
                          ...prev,
                          [line.id]: event.target.value,
                        }))
                      }
                      onBlur={() => saveInlineHourlyFields(line)}
                    />
                  </td>
                  <td className="table-num-cell">
                    <input
                      className="table-inline-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(inlineHourlyPriceDrafts[line.id] ?? line.hourlyPrice ?? 0)}
                      onChange={(event) =>
                        setInlineHourlyPriceDrafts((prev) => ({
                          ...prev,
                          [line.id]: event.target.value,
                        }))
                      }
                      onBlur={() => saveInlineHourlyFields(line)}
                    />
                  </td>
                  <td className="table-num-cell">
                    <input
                      className="table-inline-input"
                      type="number"
                      min={0}
                      step="0.01"
                      value={String(inlineHoursPerDayDrafts[line.id] ?? line.hoursPerDay ?? 0)}
                      onChange={(event) =>
                        setInlineHoursPerDayDrafts((prev) => ({
                          ...prev,
                          [line.id]: event.target.value,
                        }))
                      }
                      onBlur={() => saveInlineHourlyFields(line)}
                    />
                  </td>
                  <td className="table-num-cell">{formatAmount(line.nombreJours)}</td>
                  <td><b>{formatAmount(line.total)}</b></td>
                  <td>
                    <button type="button" className="btn-sm line-view-btn inline-action-btn" onClick={() => openQuantityModal("view", line)}>
                      <FiEye aria-hidden="true" />
                      <span>Consulter le detail</span>
                    </button>
                  </td>
                  <td>
                    <div className="line-action-group">
                      <button type="button" className="line-action-btn line-edit-btn" onClick={() => openQuantityModal("edit", line)} title="Modifier la ligne" aria-label="Modifier la ligne"><FiEdit aria-hidden="true" /></button>
                      <button type="button" className="line-action-btn line-duplicate-btn" onClick={() => duplicateLine(line.id)} title="Dupliquer la ligne" aria-label="Dupliquer la ligne"><FiCopy aria-hidden="true" /></button>
                      <button type="button" className="line-action-btn line-delete-btn" onClick={() => deleteLine(line.id)} title="Supprimer la ligne" aria-label="Supprimer la ligne"><FiTrash aria-hidden="true" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={9}>Aucune ligne pour ce scope/section.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="budget-footer">
        <div className="budget-footer-left"><div className="budget-saved">Derniere sauvegarde: <b>{lastSavedAt || "-"}</b></div></div>
        <div className="budget-footer-center">
          <div><b>Total scope :</b> {formatAmount(activeSectionScopeTotal)} DH</div>
          <div><b>Total section :</b> {formatAmount(activeSectionTotal)} DH</div>
          <div><b>Total masse salariale horaire :</b> {formatAmount(salaryHourlyScopeTotal)} DH</div>
        </div>
        <div className="budget-footer-right">
          <button type="button" className="btn-sm btn-secondary" onClick={onSave}>Enregistrer</button>{" "}
          <button type="button" className="btn-sm" onClick={onValidate}>Valider</button>
        </div>
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(7, 15, 43, 0.58)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 16 }}>
          <div style={{ width: "min(1040px, 96vw)", background: "linear-gradient(180deg, #eff5ff 0%, #ffffff 100%)", borderRadius: 20, border: "1px solid #dbe7fb", boxShadow: "0 24px 60px rgba(8, 15, 43, 0.28)", padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #dbe7fb", padding: 14, color: "var(--text-main)", minHeight: 560, display: "flex", flexDirection: "column" }}>
                <h4 style={{ marginTop: 0, textAlign: "center", fontSize: 24, fontWeight: 700, color: "var(--primary-dark)" }}>{modalMode === "view" ? "Consulter les jours" : "Remplir les jours"}</h4>
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
                        <React.Fragment key={`salary-h-qty-row-${rowIdx}`}>
                          <tr>{rowMonths.map((month) => <th key={`salary-h-qty-head-${month.key}`}>{month.label}</th>)}</tr>
                          <tr>
                            {rowMonths.map((month) => (
                              <td key={`salary-h-qty-cell-${month.key}`}>
                                {modalMode === "view" ? formatAmount(modalQty[month.key]) : (
                                  <input type="number" min={0} max={31} step="1" value={modalQty[month.key]} onChange={(event) => setModalDraftByYear((prev) => ({ ...prev, [Number(activeModalYear)]: { ...(prev[Number(activeModalYear)] || emptyMonthlyQty()), [month.key]: clampDayValue(event.target.value) } }))} style={{ width: 72 }} />
                                )}
                              </td>
                            ))}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div className="budget-modal-total-pill"><span className="gasoil-modal-emphasis-label">Total des jours:</span> <b className="gasoil-modal-emphasis-value">{formatAmount(modalTotalQty)}</b></div>
              </div>
              <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #dbe7fb", padding: 14, color: "var(--text-main)", minHeight: 560, display: "flex", flexDirection: "column" }}>
                <h4 style={{ marginTop: 0, textAlign: "center", fontSize: 24, fontWeight: 700, color: "var(--primary-dark)" }}>Details des montants</h4>
                <table className="table" style={{ background: "#fff", borderRadius: 8, overflow: "hidden", flex: 1 }}>
                  <tbody>
                    {[0, 1, 2].map((rowIdx) => {
                      const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                      return (
                        <React.Fragment key={`salary-h-amount-row-${rowIdx}`}>
                          <tr>{rowMonths.map((month) => <th key={`salary-h-amount-head-${month.key}`}>{month.label}</th>)}</tr>
                          <tr>
                            {rowMonths.map((month) => {
                              const amount = modalMonthlyAmounts.find((item) => item.key === month.key)?.amount || 0;
                              return <td key={`salary-h-amount-cell-${month.key}`}>{formatAmount(amount)}</td>;
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div className="budget-modal-total-pill budget-modal-total-pill-amount"><span className="gasoil-modal-emphasis-label">Total montants:</span> <b className="gasoil-modal-emphasis-value">{formatAmount(modalTotalAmount)} DH</b></div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              {modalMode === "view" ? (
                <button type="button" className="btn-sm" onClick={() => { setShowModal(false); setEditingLine(null); }}>Fermer</button>
              ) : (
                <>
                  <button type="button" className="btn-sm btn-secondary" onClick={() => { setShowModal(false); setEditingLine(null); }}>Annuler</button>
                  <button type="button" className="btn-sm" onClick={confirmModal}>Valider</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
