import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../styles.css";
import {
  FiBriefcase,
  FiCalendar,
  FiChevronDown,
  FiCopy,
  FiDollarSign,
  FiDroplet,
  FiEdit,
  FiEye,
  FiFile,
  FiGrid,
  FiHash,
  FiHome,
  FiLayers,
  FiList,
  FiPercent,
  FiShield,
  FiTable,
  FiTool,
  FiTrash,
  FiTrendingUp,
  FiUsers,
  FiBox,
  FiSearch,
} from "react-icons/fi";
import {
  assignSectionsToScope,
  createLigneOtp,
  createSousSection,
  getCatalogueOtps,
  getCatalogueSections,
  getCatalogueSousSections,
  getOrCreateBudget,
  getProject,
  deleteLigneOtp,
  duplicateLigneOtp,
  updateLigneOtp,
  recalculateBudget,
  validateBudget,
} from "../api/api";
import {
  getSectionOptionsFromValues,
  normalizeSectionCode,
  SECTION_OPTIONS,
} from "../constants/sections";
import {
  collectSectionLines,
  calculateGasoilRow,
  deriveGasoilRows,
  parseGasoilCatalogueCsv,
  serializeGasoilRowToPayload,
  sumGasoilRows,
} from "../services/gasoil";
import SalarySection from "./SalarySection";
import SalarySectionHoraire from "./SalarySectionHoraire";

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
const emptyMonthlyQty = () =>
  MONTHS.reduce((acc, m) => {
    acc[m.key] = "";
    return acc;
  }, {});

const detailsToYearState = (details = []) =>
  (Array.isArray(details) ? details : []).reduce((acc, detail) => {
    const year = Number(detail?.annee);
    const month = MONTHS.find((m) => m.month === Number(detail?.mois));
    if (!year || !month) return acc;
    if (!acc[year]) acc[year] = emptyMonthlyQty();
    acc[year][month.key] = String(detail?.quantite ?? "");
    return acc;
  }, {});

const buildNetAmountsFromGross = (grossAmounts = [], remiseRate = 0) => {
  const safeGross = grossAmounts.map((value) => roundAmount(Number(value || 0)));
  const totalGross = roundAmount(safeGross.reduce((sum, value) => sum + value, 0));
  const rate = normalizeDiscountRate(remiseRate);
  const targetNetTotal = roundAmount(totalGross * (1 - rate / 100));

  if (totalGross <= 0) {
    return safeGross.map(() => 0);
  }

  const netAmounts = safeGross.map(() => 0);
  let allocatedNet = 0;

  safeGross.forEach((gross, index) => {
    if (index === safeGross.length - 1) {
      netAmounts[index] = roundAmount(targetNetTotal - allocatedNet);
      return;
    }
    const proportionalNet = roundAmount((gross / totalGross) * targetNetTotal);
    netAmounts[index] = proportionalNet;
    allocatedNet = roundAmount(allocatedNet + proportionalNet);
  });

  return netAmounts;
};

const yearStateToDetails = (
  yearState = {},
  { unitPrice = 0, quantity = 0, remiseRate = 0 } = {}
) => {
  const rawDetails = Object.entries(yearState).flatMap(([year, months]) =>
    MONTHS.filter((m) => Number(months?.[m.key] || 0) > 0).map((m) => {
      const monthQty = Number(months[m.key] || 0);
      const gross = roundAmount(monthQty * Number(unitPrice || 0) * Number(quantity || 0));
      return {
        mois: m.month,
        annee: Number(year),
        quantite: monthQty,
        montant_brut: gross,
      };
    })
  );

  const netAmounts = buildNetAmountsFromGross(
    rawDetails.map((detail) => detail.montant_brut),
    remiseRate
  );

  return rawDetails.map((detail, index) => ({
    ...detail,
    montant_net: netAmounts[index] ?? 0,
  }));
};

const sumMonthlyQty = (monthlyQty = {}) =>
  MONTHS.reduce((sum, month) => sum + Number(monthlyQty?.[month.key] || 0), 0);

const sumYearState = (yearState = {}) =>
  Object.values(yearState).reduce((sum, months) => sum + sumMonthlyQty(months), 0);

const cloneDetailsMensuels = (details) =>
  Array.isArray(details)
    ? details.map((detail) => ({ ...(detail || {}) }))
    : [];

const detailAmount = (detail, field) => {
  const parsed = Number(detail?.[field]);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumDetailAmounts = (details, field) =>
  (Array.isArray(details) ? details : []).reduce(
    (sum, detail) => sum + detailAmount(detail, field),
    0
  );

const stripDetailAmounts = (details) =>
  (Array.isArray(details) ? details : []).map((detail) => ({
    mois: Number(detail?.mois || 0),
    annee: Number(detail?.annee || 0),
    quantite: Number(detail?.quantite || 0),
  }));

const calculateLineGrossTotal = (line) => {
  const detailsGross = sumDetailAmounts(line?.detailsMensuels, "montant_brut");
  if (detailsGross > 0) return detailsGross;
  return (
    Number(line?.nombreJours ?? 0) *
    Number(line?.qty ?? line?.quantite_globale ?? 0) *
    Number(line?.pu ?? 0)
  );
};

const calculateLineNetTotal = (line) => {
  const detailsNet = sumDetailAmounts(line?.detailsMensuels, "montant_net");
  if (detailsNet > 0) return detailsNet;
  const total = Number(line?.total ?? line?.montant_total ?? 0);
  return Number.isFinite(total) ? total : 0;
};

const calculateLineDiscountRate = (line) => {
  const gross = calculateLineGrossTotal(line);
  const net = calculateLineNetTotal(line);
  if (gross <= 0 || net >= gross) return 0;
  return normalizeDiscountRate(((gross - net) / gross) * 100);
};

const clampMonthlyQty = (value) => {
  if (value === "" || value == null) return "";
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return "";
  return String(Math.min(26, Math.max(0, parsed)));
};

const cloneGasoilRowSnapshot = (row) => ({
  ...row,
  catalogueEntry: row?.catalogueEntry ? { ...row.catalogueEntry } : null,
  materialLine: row?.materialLine
    ? {
        ...row.materialLine,
        detailsMensuels: cloneDetailsMensuels(row.materialLine.detailsMensuels),
      }
    : null,
  detailsMensuels: cloneDetailsMensuels(row?.detailsMensuels),
});

const getYearsBetweenDates = (startDate, endDate) => {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  const startYear = start && !Number.isNaN(start.getTime()) ? start.getFullYear() : null;
  const endYear = end && !Number.isNaN(end.getTime()) ? end.getFullYear() : null;
  const fallback = new Date().getFullYear();
  const first = startYear ?? fallback;
  const last = endYear ?? first;
  const years = [];
  for (let year = first; year <= last; year += 1) {
    years.push(year);
  }
  return years.length ? years : [fallback];
};

const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[¹]/g, "1")
    .replace(/[²]/g, "2")
    .replace(/[³]/g, "3")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "")
    .toUpperCase();

const getGasoilSourceId = (row) =>
  String(row?.sourceMaterialLineId || row?.materialLine?.id || row?.sourceId || "").trim();

const findSectionInScope = (scope, activeSectionCode) => {
  const wanted = normalize(activeSectionCode);
  const label = SECTION_OPTIONS.find((x) => x.code === activeSectionCode)?.label;
  const wantedLabel = normalize(label);
  const sections = scope?.sections || [];

  return (
    sections.find((s) => normalize(s.nom) === wanted) ||
    sections.find((s) => normalize(s.nom) === wantedLabel) ||
    null
  );
};

const MATERIAL_SUBSECTIONS = [
  "Transport",
  "Terrassement",
  "Levage",
  "Betonnage",
  "Autre",
];

const MATERIAL_SUBSECTION_MAP = {
  TRANSPORT: "Transport",
  TERRASSEMENT: "Terrassement",
  LEVAGE: "Levage",
  BETONNAGE: "Betonnage",
  AUTRE: "Autre",
};

const SECTION_TAB_ICONS = {
  INSTALLATION: FiHome,
  HSE: FiShield,
  MASSE_SALARIALE: FiUsers,
  MATERIEL: FiTool,
  GASOIL: FiDroplet,
  SOUSTRAITANCE: FiBriefcase,
  FOURNITURES: FiBox,
  AUTRES_CHARGES: FiLayers,
};

const TABLE_COLUMN_WIDTHS = ["18%", "24%", "10%", "10%", "12%", "12%", "14%", "10%"];
const GASOIL_TABLE_COLUMN_WIDTHS = [
  "10%",
  "16%",
  "10%",
  "10%",
  "10%",
  "10%",
  "11%",
  "11%",
  "10%",
  "12%",
];

const parseUnitPrice = (value) => {
  const parsed = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseFlexibleNumber = (value) => {
  const parsed = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};

const roundAmount = (value) => Number(Number(value || 0).toFixed(2));

const normalizeDiscountRate = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
};

const formatAmount = (value) =>
  new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatOptionalAmount = (value) => {
  if (value === "" || value == null) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "";
  return formatAmount(numeric);
};

const parseMaterialCatalogueCsv = (csvText) =>
  String(csvText || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      const [rawSousSection = "", rawArticle = "", rawPu = ""] = line.split(";");
      const sousSection = MATERIAL_SUBSECTION_MAP[normalize(rawSousSection)];

      if (!sousSection) return null;

      return {
        id: `materiel-${index + 1}`,
        code_otp: "-",
        sousSection,
        designation: rawArticle.trim(),
        unite: "-",
        prix_unitaire_reference: parseUnitPrice(rawPu),
      };
    })
    .filter(Boolean);

export default function BudgetEditor() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [activeSection, setActiveSection] = useState(SECTION_OPTIONS[3].code);
  const [salaryInterface, setSalaryInterface] = useState("");
  const [salaryDropdownOpen, setSalaryDropdownOpen] = useState(false);
  const [salaryDropdownPosition, setSalaryDropdownPosition] = useState({ top: 0, left: 0 });
  const salaryTabButtonRef = useRef(null);
  const [activeScopeId, setActiveScopeId] = useState(null);

  const [budget, setBudget] = useState(null);
  const [project, setProject] = useState(null);
  const [scopes, setScopes] = useState([]);
  const [catalogueSections, setCatalogueSections] = useState([]);
  const [catalogueSousSections, setCatalogueSousSections] = useState([]);
  const [catalogueOtps, setCatalogueOtps] = useState([]);
  const [materialCatalogue, setMaterialCatalogue] = useState([]);
  const [gasoilCatalogue, setGasoilCatalogue] = useState([]);
  const [gasoilPricePerL, setGasoilPricePerL] = useState("");
  const [gasoilArticleQuery, setGasoilArticleQuery] = useState("");
  const [gasoilDetailLine, setGasoilDetailLine] = useState(null);
  const [gasoilDetailActiveYear, setGasoilDetailActiveYear] = useState("");
  const [showGasoilDetailModal, setShowGasoilDetailModal] = useState(false);
  const [inlineLineDrafts, setInlineLineDrafts] = useState({});

  const [subsection, setSubsection] = useState("");
  const [subsectionQuery, setSubsectionQuery] = useState("");
  const [subsectionPickerOpen, setSubsectionPickerOpen] = useState(false);
  const [otpId, setOtpId] = useState("");
  const [article, setArticle] = useState("");
  const [articleQuery, setArticleQuery] = useState("");
  const [articlePickerOpen, setArticlePickerOpen] = useState(false);
  const subsectionWrapRef = useRef(null);
  const articleWrapRef = useRef(null);
  const [unit, setUnit] = useState("");
  const [quantite, setQuantite] = useState("1");
  const [pu, setPu] = useState("");
  const [remise, setRemise] = useState("");
  const [monthlyQtyByYear, setMonthlyQtyByYear] = useState({});
  const [monthlyQtyDraftByYear, setMonthlyQtyDraftByYear] = useState({});
  const [modalYears, setModalYears] = useState([]);
  const [activeModalYear, setActiveModalYear] = useState("");
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingLineId, setEditingLineId] = useState(null);
  const [modalHasUserChanges, setModalHasUserChanges] = useState(false);
  const [lineSectionOverride, setLineSectionOverride] = useState("");
  const lineFormRef = useRef({
    subsection: "",
    otpId: "",
    article: "",
    articleQuery: "",
    unit: "",
    quantite: "1",
    pu: "",
    remise: "",
    monthlyQtyByYear: {},
    monthlyQtyDraftByYear: {},
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");

  const getInlineLineValue = useCallback(
    (lineId, field, fallback) => inlineLineDrafts?.[lineId]?.[field] ?? fallback,
    [inlineLineDrafts]
  );

  const setInlineLineField = useCallback((lineId, field, value) => {
    setInlineLineDrafts((prev) => ({
      ...prev,
      [lineId]: {
        ...(prev[lineId] || {}),
        [field]: value,
      },
    }));
  }, []);

  const clearInlineLineDraft = useCallback((lineId) => {
    setInlineLineDrafts((prev) => {
      if (!prev[lineId]) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const refreshBudget = async () => {
    setLoading(true);
    setError("");
    try {
      const b = await getOrCreateBudget(projectId);
      setBudget(b);
      setScopes(Array.isArray(b?.scopes) ? b.scopes : []);
      if (!activeScopeId && Array.isArray(b?.scopes) && b.scopes.length > 0) {
        setActiveScopeId(b.scopes[0].id);
      }
      return b;
    } catch (e) {
      setError(e?.message || "Erreur API");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${process.env.PUBLIC_URL}/data/materiel-catalogue.csv`);
        if (!response.ok) {
          throw new Error("Catalogue Materiel introuvable.");
        }

        const csvText = await response.text();
        setMaterialCatalogue(parseMaterialCatalogueCsv(csvText));
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(`${process.env.PUBLIC_URL}/data/gasoil-catalogue.csv`);
        if (!response.ok) {
          throw new Error("Catalogue Gasoil introuvable.");
        }
        const csvText = await response.text();
        setGasoilCatalogue(parseGasoilCatalogueCsv(csvText));
      } catch (e) {
        setGasoilCatalogue([]);
      }
    })();
  }, []);

  useEffect(() => {
    lineFormRef.current = {
      subsection,
      otpId,
      article,
      articleQuery,
      unit,
      quantite,
      pu,
      remise,
      monthlyQtyByYear,
      monthlyQtyDraftByYear,
      sectionCode: lineSectionOverride,
    };
  }, [
    subsection,
    otpId,
    article,
    articleQuery,
    unit,
    quantite,
    pu,
    remise,
    monthlyQtyByYear,
    monthlyQtyDraftByYear,
    lineSectionOverride,
  ]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const cats = await getCatalogueSections();
        setCatalogueSections(Array.isArray(cats) ? cats : []);
      } catch (e) {
        setError(e?.message || "Erreur API (catalogue sections)");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    refreshBudget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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

  useEffect(() => {
    (async () => {
      try {
        const data = await getProject(projectId);
        setProject(data);
      } catch (e) {
        // Le budget peut rester utilisable même si le projet ne se recharge pas ici.
      }
    })();
  }, [projectId]);

  // Quand on change de scope (ou d'onglet), on vide les champs de saisie
  useEffect(() => {
    if (showMonthlyModal) return;
    // Ne réinitialiser que si aucun formulaire n'est en cours de saisie
    if (!articleQuery && !subsection && !pu) {
      setRemise("");
      lineFormRef.current.remise = "";
      setShowMonthlyModal(false);
      setArticlePickerOpen(false);
    }

    // remettre PU/unité/designation sur la référence catalogue (si OTP sélectionné)
    const found = availableCatalogueOtps.find((o) => String(o.id) === String(otpId));
    if (found && !articleQuery) {
      setArticle(found.designation || "");
      setUnit("Jour/Mois");
      setPu(
        found.prix_unitaire_reference != null
          ? String(found.prix_unitaire_reference)
          : ""
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScopeId, activeSection]);

  const activeScope = useMemo(
    () => scopes.find((s) => s.id === activeScopeId) || null,
    [scopes, activeScopeId]
  );

  const projectScopeList = useMemo(() => {
    try {
      const raw = project?.scope;
      if (!raw) return [];
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [project]);

  const activeProjectScope = useMemo(() => {
    if (!activeScope) return null;
    const activeName = normalize(activeScope.nom);
    return (
      projectScopeList.find((item) => normalize(item?.nom || item?.name) === activeName) ||
      null
    );
  }, [activeScope, projectScopeList]);

  useEffect(() => {
    if (activeSection !== "GASOIL") return;
    setGasoilPricePerL("");
  }, [activeSection, activeScopeId]);

  const scopeYears = useMemo(() => {
    const start = activeProjectScope?.date_debut || project?.scope_start_date || project?.start_date;
    const end = activeProjectScope?.date_fin || project?.scope_end_date || project?.end_date;
    return getYearsBetweenDates(start, end);
  }, [activeProjectScope, project]);

  const activeSectionCodes = useMemo(() => {
    if (!activeScope) return [];
    return (activeScope.sections || [])
      .map((section) => normalizeSectionCode(section.nom))
      .filter(Boolean);
  }, [activeScope]);

  const visibleSections = useMemo(
    () => getSectionOptionsFromValues(activeSectionCodes),
    [activeSectionCodes]
  );

  const isMaterialSection = activeSection === "MATERIEL";
  const isGasoilSection = activeSection === "GASOIL";
  const isSalarySection = activeSection === "MASSE_SALARIALE";

  const selectSalaryInterface = (nextInterface) => {
    setSalaryInterface(nextInterface);
    setActiveSection("MASSE_SALARIALE");
    setSalaryDropdownOpen(false);
  };

  const updateSalaryDropdownPosition = useCallback(() => {
    const button = salaryTabButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setSalaryDropdownPosition({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }, []);

  const toggleSalaryPanel = () => {
    setSalaryDropdownOpen((prev) => {
      const next = !prev;
      if (next) updateSalaryDropdownPosition();
      return next;
    });
  };

  useEffect(() => {
    if (!salaryDropdownOpen) return;
    const handleViewportChange = () => updateSalaryDropdownPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [salaryDropdownOpen, updateSalaryDropdownPosition]);
  const salaryDropdownButtonStyle = (isActive) => ({
    width: "100%",
    textAlign: "left",
    borderRadius: 10,
    padding: "10px 12px",
    border: "1px solid transparent",
    fontWeight: 600,
    letterSpacing: "0.1px",
    background: isActive ? "linear-gradient(135deg, #0f3f8a 0%, #1b5fc4 100%)" : "#f8fafc",
    color: isActive ? "#ffffff" : "#0f172a",
    boxShadow: isActive ? "0 10px 20px rgba(27, 95, 196, 0.28)" : "none",
    transition: "all 0.2s ease",
    cursor: "pointer",
  });

  useEffect(() => {
    setGasoilArticleQuery("");
    if (!isGasoilSection) {
      setGasoilDetailLine(null);
      setShowGasoilDetailModal(false);
    }
  }, [isGasoilSection]);
  const materialSousSections = useMemo(
    () =>
      MATERIAL_SUBSECTIONS.filter((name) =>
        materialCatalogue.some((item) => item.sousSection === name)
      ).map((name) => ({
        id: name,
        nom_sous_section: name,
      })),
    [materialCatalogue]
  );

  const materialOtps = useMemo(
    () =>
      materialCatalogue
        .filter((item) => item.sousSection === subsection)
        .map((item) => ({
          id: item.id,
          code_otp: item.code_otp,
          designation: item.designation,
          unite: item.unite,
          prix_unitaire_reference: item.prix_unitaire_reference,
        })),
    [materialCatalogue, subsection]
  );

  const availableCatalogueSousSections = isMaterialSection
    ? materialSousSections
    : catalogueSousSections;

  const availableCatalogueOtps = isMaterialSection ? materialOtps : catalogueOtps;

  const filteredCatalogueSousSections = useMemo(() => {
    const query = String(subsectionQuery || "").trim().toLowerCase();
    if (!query) return availableCatalogueSousSections;
    return availableCatalogueSousSections.filter((item) =>
      String(item?.nom_sous_section || "").toLowerCase().includes(query)
    );
  }, [availableCatalogueSousSections, subsectionQuery]);

  const buildGasoilRowsForScope = useCallback(
    (scope) => {
      if (!scope) return [];
      const materialLines = collectSectionLines(scope, "MATERIEL");
      const draftRows = deriveGasoilRows(materialLines, gasoilCatalogue, null);
      const savedRows = collectSectionLines(scope, "GASOIL");
      const savedRowsBySourceId = new Map();
      const legacySavedRows = [];

      savedRows.forEach((savedRow) => {
        const sourceId = getGasoilSourceId(savedRow);
        if (sourceId) {
          savedRowsBySourceId.set(sourceId, savedRow);
        } else {
          legacySavedRows.push(savedRow);
        }
      });

      let legacyCursor = 0;
      return draftRows.map((draftRow) => {
        const sourceId = getGasoilSourceId(draftRow);
        const savedRow =
          savedRowsBySourceId.get(sourceId) ||
          legacySavedRows[legacyCursor] ||
          null;
        if (!savedRowsBySourceId.get(sourceId) && legacySavedRows[legacyCursor]) {
          legacyCursor += 1;
        }
        if (savedRow) {
          const preservedPriceRaw = savedRow?.pu ?? null;
          const preservedPrice =
            preservedPriceRaw === "" || preservedPriceRaw == null ? null : Number(preservedPriceRaw);
          return cloneGasoilRowSnapshot({
            ...draftRow,
            id: savedRow.id || draftRow.id,
            isPersisted: true,
            prixPerL: preservedPrice,
            montantTotal: Number(savedRow?.total ?? draftRow.montantTotal ?? 0),
            nombreMateriels: Number(savedRow?.qty ?? draftRow.nombreMateriels ?? 0),
            nombreJours: Number(savedRow?.nombreJours ?? draftRow.nombreJours ?? 0),
            sourceMaterialLineId: sourceId || savedRow?.sourceMaterialLineId || "",
          });
        }

        const recalculated = calculateGasoilRow(draftRow.materialLine, gasoilCatalogue, null);
        return cloneGasoilRowSnapshot({
          ...recalculated,
          id: draftRow.id,
          isPersisted: false,
          prixPerL: null,
          sourceMaterialLineId: sourceId,
        });
      });
    },
    [gasoilCatalogue]
  );

  const gasoilRows = useMemo(() => {
    if (!isGasoilSection) return [];
    return buildGasoilRowsForScope(activeScope);
  }, [activeScope, buildGasoilRowsForScope, isGasoilSection]);

  const handleGasoilPricePerLChange = useCallback(
    (nextValue) => {
      setGasoilPricePerL(nextValue);
      if (!isGasoilSection) return;
      if (nextValue === "" || nextValue == null) return;

      setInlineLineDrafts((prev) => {
        const next = { ...prev };
        for (const row of gasoilRows) {
          const draftPrice = next[row.id]?.prixPerL;
          const hasRowPrice = row?.prixPerL !== null && row?.prixPerL !== undefined && row?.prixPerL !== "";
          const isFollowingGlobalValue =
            draftPrice !== undefined && String(draftPrice) === String(gasoilPricePerL ?? "");
          if (!hasRowPrice && (draftPrice === undefined || isFollowingGlobalValue)) {
            next[row.id] = {
              ...(next[row.id] || {}),
              prixPerL: nextValue,
            };
          }
        }
        return next;
      });
    },
    [gasoilRows, isGasoilSection, gasoilPricePerL]
  );

  useEffect(() => {
    if (!isGasoilSection) return;
    if (gasoilPricePerL === "" || gasoilPricePerL == null) return;

    setInlineLineDrafts((prev) => {
      const next = { ...prev };
      for (const row of gasoilRows) {
        const hasDraftPrice = next[row.id]?.prixPerL !== undefined;
        const hasRowPrice = row?.prixPerL !== null && row?.prixPerL !== undefined && row?.prixPerL !== "";
        if (!hasDraftPrice && !hasRowPrice) {
          next[row.id] = {
            ...(next[row.id] || {}),
            prixPerL: gasoilPricePerL,
          };
        }
      }
      return next;
    });
  }, [gasoilPricePerL, gasoilRows, isGasoilSection]);

  const getSectionScopeTotal = useCallback(
    (scope, sectionCode) => {
      if (!scope) return 0;
      if (sectionCode === "GASOIL") {
        return sumGasoilRows(buildGasoilRowsForScope(scope));
      }
      return collectSectionLines(scope, sectionCode).reduce(
        (sum, line) => sum + Number(line?.total ?? line?.montant_total ?? 0),
        0
      );
    },
    [buildGasoilRowsForScope]
  );

  const getSalaryScopeTotalByInterface = useCallback((scope, interfaceType) => {
    if (!scope) return 0;
    const backendValue =
      interfaceType === "H"
        ? Number(scope?.total_masse_salariale_horaire)
        : Number(scope?.total_masse_salariale_mensuel);
    if (Number.isFinite(backendValue)) return backendValue;

    const wantedUnit = interfaceType === "H" ? "JOUR" : "MOIS";
    return collectSectionLines(scope, "MASSE_SALARIALE").reduce((sum, line) => {
      const lineUnit = normalize(line?.unit ?? line?.unite ?? "");
      if (lineUnit !== wantedUnit) return sum;
      return sum + Number(line?.total ?? line?.montant_total ?? 0);
    }, 0);
  }, []);

  const activeSectionScopeTotal = useMemo(
    () => getSectionScopeTotal(activeScope, activeSection),
    [activeScope, activeSection, getSectionScopeTotal]
  );

  const activeSectionTotal = useMemo(
    () => scopes.reduce((sum, scope) => sum + getSectionScopeTotal(scope, activeSection), 0),
    [scopes, activeSection, getSectionScopeTotal]
  );

  const salaryMonthlyScopeTotal = useMemo(
    () => getSalaryScopeTotalByInterface(activeScope, "M"),
    [activeScope, getSalaryScopeTotalByInterface]
  );

  const salaryMonthlySectionTotal = useMemo(
    () => scopes.reduce((sum, scope) => sum + getSalaryScopeTotalByInterface(scope, "M"), 0),
    [scopes, getSalaryScopeTotalByInterface]
  );

  const salaryHourlyScopeTotal = useMemo(
    () => getSalaryScopeTotalByInterface(activeScope, "H"),
    [activeScope, getSalaryScopeTotalByInterface]
  );

  const salaryHourlySectionTotal = useMemo(
    () => scopes.reduce((sum, scope) => sum + getSalaryScopeTotalByInterface(scope, "H"), 0),
    [scopes, getSalaryScopeTotalByInterface]
  );

  const filteredCatalogueOtps = useMemo(() => {
    const query = String(articleQuery || "").trim().toLowerCase();
    if (!query) return availableCatalogueOtps;
    return availableCatalogueOtps
      .filter((item) => {
        const searchable = [item.designation, item.code_otp, item.unite]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        return searchable.includes(query);
      })
      ;
  }, [availableCatalogueOtps, articleQuery]);

  const selectSubsection = (value) => {
    setSubsection(value);
    setSubsectionQuery(value);
    lineFormRef.current.subsection = value;
    setSubsectionPickerOpen(false);
    setOtpId("");
    lineFormRef.current.otpId = "";
    setArticle("");
    lineFormRef.current.article = "";
    setArticleQuery("");
    lineFormRef.current.articleQuery = "";
    setUnit("");
    lineFormRef.current.unit = "";
    setPu("");
    lineFormRef.current.pu = "";
    setArticlePickerOpen(false);
  };

  const onSubsectionQueryChange = (value) => {
    setSubsectionQuery(value);
    setSubsectionPickerOpen(true);
    const exact = availableCatalogueSousSections.find(
      (item) => normalize(item?.nom_sous_section) === normalize(value)
    );
    const nextSubsection = exact?.nom_sous_section || "";
    setSubsection(nextSubsection);
    lineFormRef.current.subsection = nextSubsection;
    setOtpId("");
    lineFormRef.current.otpId = "";
    setArticle("");
    lineFormRef.current.article = "";
    setArticleQuery("");
    lineFormRef.current.articleQuery = "";
    setUnit("");
    lineFormRef.current.unit = "";
    setPu("");
    lineFormRef.current.pu = "";
    setArticlePickerOpen(false);
  };

  const totalDaysFromMonthly = useMemo(() => {
    return sumYearState(monthlyQtyByYear);
  }, [monthlyQtyByYear]);

  const filteredGasoilRows = useMemo(() => {
    if (!isGasoilSection) return [];
    const query = String(gasoilArticleQuery || "").trim().toLowerCase();
    if (!query) return gasoilRows;
    return gasoilRows.filter((row) =>
      [row.article, row.subsection]
        .map((value) => String(value || "").toLowerCase())
        .join(" ")
        .includes(query)
    );
  }, [gasoilArticleQuery, gasoilRows, isGasoilSection]);

  const gasoilDetailYearState = useMemo(
    () =>
      detailsToYearState(
        gasoilDetailLine?.materialLine?.detailsMensuels ||
          gasoilDetailLine?.detailsMensuels ||
          []
      ),
    [gasoilDetailLine]
  );

  const gasoilDetailYears = useMemo(
    () => Object.keys(gasoilDetailYearState).map(Number).sort((a, b) => a - b),
    [gasoilDetailYearState]
  );

  const gasoilDetailModalQty = useMemo(
    () => gasoilDetailYearState[Number(gasoilDetailActiveYear)] || emptyMonthlyQty(),
    [gasoilDetailYearState, gasoilDetailActiveYear]
  );

  const gasoilDetailMonthlyAmounts = useMemo(() => {
    const heuresMarche = Number(gasoilDetailLine?.heuresMarche || 0);
    const consommationLH = Number(gasoilDetailLine?.consommationLH || 0);
    const nombreMateriels = Number(gasoilDetailLine?.nombreMateriels || 0);
    const prixPerL = Number(gasoilDetailLine?.prixPerL ?? gasoilPricePerL ?? 0);
    const consommationJournaliereL = heuresMarche * consommationLH;
    return MONTHS.map((m) => {
      const qty = Number(gasoilDetailModalQty[m.key] || 0);
      const amount = qty * nombreMateriels * consommationJournaliereL * prixPerL;
      return { ...m, qty, amount };
    });
  }, [gasoilDetailLine, gasoilDetailModalQty, gasoilPricePerL]);

  const gasoilDetailTotalAmount = useMemo(
    () => gasoilDetailMonthlyAmounts.reduce((sum, m) => sum + Number(m.amount || 0), 0),
    [gasoilDetailMonthlyAmounts]
  );

  const filteredLines = useMemo(() => {
    if (isGasoilSection) return [];
    if (!activeScope) return [];
    const section = findSectionInScope(activeScope, activeSection);
    if (!section) return [];

    const out = [];
    for (const ss of section.sous_sections || []) {
      for (const line of ss.lignes_otp || []) {
        const detailsState = detailsToYearState(line.details_mensuels || []);
        const row = {
          id: line.id,
          otp: line.code_otp,
          subsection: ss.nom,
          article: line.designation,
          unit: line.unite,
          nombreJours: sumYearState(detailsState) || Number(line.nombre_jours ?? 0),
          pu: line.prix_unitaire,
          qty: Number(line.quantite_globale ?? 0),
          total: line.montant_total,
          detailsQty: "consulter le détail",
          detailsAmounts: "consulter le détail",
          detailsMensuels: line.details_mensuels || [],
        };
        row.montantBrut = calculateLineGrossTotal(row);
        row.montantNet = calculateLineNetTotal(row);
        row.remiseRate = calculateLineDiscountRate(row);
        out.push(row);
      }
    }
    // Les lignes les plus récentes doivent remonter en premier dans le tableau.
    return out.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }, [activeScope, activeSection, isGasoilSection]);

  const duplicateRow = async (lineId) => {
    try {
      await duplicateLigneOtp(lineId);
      await refreshBudget();
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const applyLineToForm = (line) => {
    if (!line) return;
    setSubsection(line.subsection || "");
    setSubsectionQuery(line.subsection || "");
    lineFormRef.current.subsection = line.subsection || "";
    setArticle(line.article || "");
    lineFormRef.current.article = line.article || "";
    setArticleQuery(line.article || "");
    lineFormRef.current.articleQuery = line.article || "";
    const matchedOtp = availableCatalogueOtps.find((item) => {
      const matchDesignation = normalize(item.designation) === normalize(line.article);
      const matchCode = normalize(item.code_otp) === normalize(line.otp);
      return matchDesignation || matchCode;
    });
    const nextOtpId = matchedOtp ? String(matchedOtp.id) : "";
    setOtpId(nextOtpId);
    lineFormRef.current.otpId = nextOtpId;
    setUnit(line.unit || "Jour/Mois");
    lineFormRef.current.unit = line.unit || "Jour/Mois";
    const nextQuantite = String(line.qty ?? line.quantite_globale ?? 1);
    setQuantite(nextQuantite);
    lineFormRef.current.quantite = nextQuantite;
    setPu(line.pu != null ? String(line.pu) : "");
    lineFormRef.current.pu = line.pu != null ? String(line.pu) : "";
    const nextRemise = calculateLineDiscountRate(line);
    const nextRemiseText = nextRemise > 0 ? String(roundAmount(nextRemise)) : "";
    setRemise(nextRemiseText);
    lineFormRef.current.remise = nextRemiseText;
  };

  const currentLineGross = useMemo(() => {
    const p = Number(pu || 0);
    const q = Number(quantite || 0);
    return totalDaysFromMonthly * p * q;
  }, [totalDaysFromMonthly, pu, quantite]);

  const currentLineTotal = useMemo(() => {
    const r = normalizeDiscountRate(remise);
    const discount = currentLineGross * (r / 100);
    return Math.max(0, currentLineGross - discount);
  }, [currentLineGross, remise]);

  const currentLineDiscount = useMemo(() => {
    const r = normalizeDiscountRate(remise);
    return Math.max(0, currentLineGross * (r / 100));
  }, [currentLineGross, remise]);

  const activeScopeIndex = useMemo(() => {
    if (!activeScopeId) return -1;
    return scopes.findIndex((s) => s.id === activeScopeId);
  }, [scopes, activeScopeId]);

  const goToProjectEditor = () => {
    navigate(`/create-project/${projectId}`);
  };

  const openGasoilDetailModal = (row) => {
    setGasoilDetailLine(row);
    const detailYears = Array.from(
      new Set(
        Object.keys(
          detailsToYearState(row?.materialLine?.detailsMensuels || row?.detailsMensuels || []) || {}
        ).map(Number)
      )
    ).sort((a, b) => a - b);
    setGasoilDetailActiveYear(String(detailYears[0] || new Date().getFullYear()));
    setShowGasoilDetailModal(true);
  };

  const saveInlineLineEdit = async (sectionCode, line) => {
    if (!line?.id) return;

    const draft = inlineLineDrafts[line.id] || {};
    const isGasoil = sectionCode === "GASOIL";
    const nextQty = Math.max(1, Math.floor(Number(draft.qty ?? line.qty ?? line.quantite_globale ?? 1) || 1));
    const nextPu = Number(draft.pu ?? line.pu ?? line.prixPerL ?? 0);
    const nextHeuresMarche = Number(draft.heuresMarche ?? line.heuresMarche ?? 0);
    const nextConsommationLH = Number(draft.consommationLH ?? line.consommationLH ?? 0);

    try {
      if (isGasoil) {
        const pricePerLRaw = draft.prixPerL ?? line.prixPerL ?? gasoilPricePerL;
        const pricePerL =
          pricePerLRaw === "" || pricePerLRaw == null ? null : Number(pricePerLRaw);
        const nombreMateriels = Number(line.nombreMateriels || 0);
        const nombreJours = Number(line.nombreJours || 0);
        const consommationJournaliereL = nextHeuresMarche * nextConsommationLH;
        const montantTotal = nombreJours * consommationJournaliereL * nombreMateriels * (pricePerL ?? 0);

        await updateLigneOtp(line.id, {
          code_otp: line.codeOtp || line.otp || "-",
          section: "GASOIL",
          designation: line.article || "",
          unite: "L",
          nombre_jours: nombreJours,
          quantite_globale: nombreMateriels,
          prix_unitaire: pricePerL,
          montant_total: montantTotal,
          heures_marche: nextHeuresMarche,
          consommation_l_h: nextConsommationLH,
          details_mensuels: stripDetailAmounts(line.detailsMensuels),
        });
      } else {
        const nombreJours = Number(line.nombreJours || 0);
        const remiseRate = normalizeDiscountRate(line.remiseRate);
        const grossTotal = nombreJours * nextQty * nextPu;
        const montantTotal = roundAmount(grossTotal * (1 - remiseRate / 100));
        const detailState = detailsToYearState(line.detailsMensuels || []);

        await updateLigneOtp(line.id, {
          code_otp: line.otp || line.codeOtp || "-",
          section: sectionCode,
          designation: line.article || "",
          unite: line.unit || "Jour/Mois",
          quantite_globale: nextQty,
          prix_unitaire: nextPu,
          montant_total: montantTotal,
          nombre_jours: nombreJours,
          details_mensuels: yearStateToDetails(detailState, {
            unitPrice: nextPu,
            quantity: nextQty,
            remiseRate,
          }),
        });
      }

      clearInlineLineDraft(line.id);
      await refreshBudget();
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const goPrevScope = () => {
    if (activeScopeIndex <= 0) return;
    setActiveScopeId(scopes[activeScopeIndex - 1].id);
  };

  const goNextScope = () => {
    if (activeScopeIndex < 0 || activeScopeIndex >= scopes.length - 1) return;
    setActiveScopeId(scopes[activeScopeIndex + 1].id);
  };

  const activeCatalogueSection = useMemo(() => {
    const wanted = normalize(activeSection);
    const label = SECTION_OPTIONS.find((x) => x.code === activeSection)?.label;
    const wantedLabel = normalize(label);
    return (
      catalogueSections.find((c) => normalize(c.nom_section) === wanted) ||
      catalogueSections.find((c) => normalize(c.nom_section) === wantedLabel) ||
      null
    );
  }, [catalogueSections, activeSection]);

  useEffect(() => {
    if (!visibleSections.length) return;
    const stillVisible = visibleSections.some((section) => section.code === activeSection);
    if (!stillVisible) {
      setActiveSection(visibleSections[0].code);
    }
  }, [activeSection, visibleSections]);

  useEffect(() => {
    if (isMaterialSection) {
      setCatalogueSousSections([]);
      setSubsection((current) => {
        if (
          current &&
          materialSousSections.some((item) => item.nom_sous_section === current)
        ) {
          setSubsectionQuery(current);
          return current;
        }
        setSubsectionQuery("");
        return "";
      });
      return;
    }

    if (!activeCatalogueSection) {
      setCatalogueSousSections([]);
      setSubsection("");
      setSubsectionQuery("");
      return;
    }
    (async () => {
      try {
        const ss = await getCatalogueSousSections(activeCatalogueSection.id);
        const list = Array.isArray(ss) ? ss : [];
        setCatalogueSousSections(list);
        setSubsection("");
        setSubsectionQuery("");
      } catch (e) {
        setError(e?.message || "Erreur API (catalogue sous-sections)");
      }
    })();
  }, [activeCatalogueSection, isMaterialSection, materialSousSections]);

  useEffect(() => {
    if (isMaterialSection) {
      setCatalogueOtps([]);
      return;
    }

    const selected = catalogueSousSections.find((x) => x.nom_sous_section === subsection);
    if (!selected) {
      setCatalogueOtps([]);
      return;
    }

    (async () => {
      try {
        const otps = await getCatalogueOtps(selected.id);
        const list = Array.isArray(otps) ? otps : [];
        setCatalogueOtps(list);
      } catch (e) {
        setError(e?.message || "Erreur API (catalogue OTPs)");
      }
    })();
  }, [
    subsection,
    catalogueSousSections,
    isMaterialSection,
    materialOtps,
    editingLineId,
    modalMode,
    showMonthlyModal,
  ]);

  useEffect(() => {
    const found = availableCatalogueOtps.find((o) => String(o.id) === String(otpId));
    if (!found) {
      return;
    }

    const snapshot = lineFormRef.current || {};
    // Ne pas écraser la saisie utilisateur: compléter uniquement les champs vides.
    if (!snapshot.article) {
      setArticle(found.designation || "");
      lineFormRef.current.article = found.designation || "";
    }
    if (!snapshot.articleQuery) {
      setArticleQuery(found.designation || "");
      lineFormRef.current.articleQuery = found.designation || "";
    }
    if (!snapshot.unit) {
      setUnit("Jour/Mois");
      lineFormRef.current.unit = "Jour/Mois";
    }
    if (!snapshot.pu) {
      setPu(
        found.prix_unitaire_reference != null
          ? String(found.prix_unitaire_reference)
          : ""
      );
      lineFormRef.current.pu =
        found.prix_unitaire_reference != null
          ? String(found.prix_unitaire_reference)
          : "";
    }
  }, [otpId, availableCatalogueOtps]);

  const onArticleQueryChange = (value) => {
    setArticleQuery(value);
    setArticlePickerOpen(true);
    lineFormRef.current.articleQuery = value;

    const normalized = normalize(value);
    const exact = availableCatalogueOtps.find((item) => {
      const designation = normalize(item.designation);
      const code = normalize(item.code_otp);
      return designation === normalized || code === normalized;
    });

    if (exact) {
      const nextOtpId = String(exact.id);
      setOtpId(nextOtpId);
      lineFormRef.current.otpId = nextOtpId;
      setArticle(exact.designation || "");
      lineFormRef.current.article = exact.designation || "";
      setArticleQuery(exact.designation || "");
      lineFormRef.current.articleQuery = exact.designation || "";
      if (!unit) {
        setUnit("Jour/Mois");
        lineFormRef.current.unit = "Jour/Mois";
      }
      if (!pu) {
        setPu(
          exact.prix_unitaire_reference != null
            ? String(exact.prix_unitaire_reference)
            : ""
        );
        lineFormRef.current.pu =
          exact.prix_unitaire_reference != null
            ? String(exact.prix_unitaire_reference)
            : "";
      }
    } else if (!isMaterialSection) {
      setOtpId("");
      lineFormRef.current.otpId = "";
      setArticle(value);
      lineFormRef.current.article = value;
      setArticleQuery(value);
      lineFormRef.current.articleQuery = value;
    } else {
      setOtpId("");
      lineFormRef.current.otpId = "";
      setArticle("");
      lineFormRef.current.article = "";
      if (!String(value || "").trim()) {
        setUnit("");
        lineFormRef.current.unit = "";
        setPu("");
        lineFormRef.current.pu = "";
      }
    }
  };

  const selectArticle = (item) => {
    const nextOtpId = String(item.id);
    setOtpId(nextOtpId);
    lineFormRef.current.otpId = nextOtpId;
    setArticle(item.designation || "");
    setArticleQuery(item.designation || "");
    lineFormRef.current.article = item.designation || "";
    lineFormRef.current.articleQuery = item.designation || "";
    setArticlePickerOpen(false);
    setUnit("Jour/Mois");
    lineFormRef.current.unit = "Jour/Mois";
    setPu(item.prix_unitaire_reference != null ? String(item.prix_unitaire_reference) : "");
    lineFormRef.current.pu =
      item.prix_unitaire_reference != null ? String(item.prix_unitaire_reference) : "";
  };

  const ensureActiveSectionInScope = async (sectionCode = activeSection) => {
    if (!activeScope) return null;

    const existingSection = findSectionInScope(activeScope, sectionCode);
    if (existingSection) return existingSection;
    const wantedSection = normalize(sectionCode);
    const wantedLabel = normalize(SECTION_OPTIONS.find((x) => x.code === sectionCode)?.label);
    const targetCatalogueSection =
      catalogueSections.find((c) => normalize(c.nom_section) === wantedSection) ||
      catalogueSections.find((c) => normalize(c.nom_section) === wantedLabel) ||
      null;
    const scopeCatalogueSectionId =
      targetCatalogueSection?.id || activeScope?.section_id || catalogueSections[0]?.id;

    if (!scopeCatalogueSectionId) {
      if (visibleSections.length > 0) {
        setActiveSection(visibleSections[0].code);
      }
      return null;
    }

    const existingCatalogueIds = (activeScope.sections || [])
      .map((section) => section.catalogue_id)
      .filter((id) => id != null);
    const nextCatalogueIds = Array.from(new Set([...existingCatalogueIds, scopeCatalogueSectionId]));

    await assignSectionsToScope(activeScope.id, nextCatalogueIds);
    const refreshedBudget = await refreshBudget();
    const refreshedScopes = Array.isArray(refreshedBudget?.scopes)
      ? refreshedBudget.scopes
      : [];
    const refreshedScope =
      refreshedScopes.find((scope) => scope.id === activeScope.id) || null;

    return findSectionInScope(refreshedScope, sectionCode);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await addLine();
  };

  const addLine = async (yearState = monthlyQtyByYear) => {
    const snapshot = lineFormRef.current || {};
    const targetSectionCode = snapshot.sectionCode || activeSection;
    const effectiveYearState =
      snapshot.monthlyQtyByYear && Object.keys(snapshot.monthlyQtyByYear).length > 0
        ? snapshot.monthlyQtyByYear
        : yearState && Object.keys(yearState).length > 0
        ? yearState
        : snapshot.monthlyQtyDraftByYear && Object.keys(snapshot.monthlyQtyDraftByYear).length > 0
        ? snapshot.monthlyQtyDraftByYear
        : monthlyQtyDraftByYear;
    const q = Number(parseFlexibleNumber(snapshot.quantite || quantite) || 0);
    const r = normalizeDiscountRate(snapshot.remise ?? remise);
    const effectiveArticle = String(snapshot.article || article || "").trim();
    const effectiveUnit = "Jour/Mois";
    const effectivePu = parseFlexibleNumber(snapshot.pu || pu);
    const effectiveNombreJours = Math.max(0, Math.floor(sumYearState(effectiveYearState)));
    const effectiveSubsection = String(snapshot.subsection || subsection || "").trim();
    const effectiveOtpId = String(snapshot.otpId || otpId || "");
    const materialCatalogueSubsection = availableCatalogueSousSections.find(
      (item) => item.nom_sous_section === effectiveSubsection
    );
    const matchedMaterialOtp =
      availableCatalogueOtps.find((o) => String(o.id) === effectiveOtpId) ||
      availableCatalogueOtps.find((o) => normalize(o.designation) === normalize(effectiveArticle)) ||
      null;

    if (!effectiveSubsection || !effectiveArticle || !effectiveUnit || !Number.isFinite(effectivePu) || q <= 0) {
      alert("Veuillez remplir l'article, la quantité, le P.U et les détails des jours.");
      return;
    }
    if (isMaterialSection && !materialCatalogueSubsection) {
      alert("Veuillez choisir une sous-section existante dans la liste Matériel.");
      return;
    }
    if (isMaterialSection && !matchedMaterialOtp) {
      alert("Veuillez choisir un article existant dans la liste.");
      return;
    }
    if (!Number.isFinite(effectiveNombreJours) || effectiveNombreJours < 0) {
      alert("Le total des jours doit être valide.");
      return;
    }
    if (effectiveNombreJours <= 0) {
      alert("Veuillez remplir au moins une case dans les jours/mois.");
      return;
    }
    if (Number.isNaN(r) || r < 0 || r > 100) {
      alert("La remise doit être entre 0% et 100%.");
      return;
    }

    if (!activeScope) {
      alert("Veuillez sélectionner un scope.");
      return;
    }

    try {
      const section = await ensureActiveSectionInScope(targetSectionCode);
      if (!section) {
        alert("Section non disponible pour ce scope.");
        return;
      }

      // 1) s'assurer que la sous-section existe dans cette section budgetaire
      let existingSs =
        (section.sous_sections || []).find((x) => x.nom === effectiveSubsection) || null;
      if (!existingSs) {
        existingSs = await createSousSection(section.id, { nom: effectiveSubsection });
      }

      // 2) créer la ligne OTP en DB
      const foundOtp = matchedMaterialOtp;
      const payload = {
        code_otp: foundOtp?.code_otp || "-",
        section: targetSectionCode,
        designation: foundOtp?.designation || effectiveArticle,
        unite: effectiveUnit,
        quantite_globale: q,
        prix_unitaire: effectivePu,
        montant_total: roundAmount(q * effectivePu * effectiveNombreJours * (1 - r / 100)),
        nombre_jours: effectiveNombreJours,
        details_mensuels: yearStateToDetails(effectiveYearState, {
          unitPrice: effectivePu,
          quantity: q,
          remiseRate: r,
        }),
      };
      if (editingLineId) {
        await updateLigneOtp(editingLineId, payload);
      } else {
        await createLigneOtp(existingSs.id, payload);
      }

      // 3) refresh budget (inclut toutes les lignes)
      await refreshBudget();

      setSubsection("");
      setSubsectionQuery("");
      lineFormRef.current.subsection = "";
      setArticle("");
      setArticleQuery("");
      setOtpId("");
      setUnit("Jour/Mois");
      setQuantite("1");
      lineFormRef.current.unit = "Jour/Mois";
      lineFormRef.current.quantite = "1";
      setPu("");
      setRemise("");
      lineFormRef.current.remise = "";
      setMonthlyQtyByYear({});
      setMonthlyQtyDraftByYear({});
      setModalYears([]);
      setActiveModalYear("");
      setEditingLineId(null);
      setLineSectionOverride("");
      setArticlePickerOpen(false);
      setShowMonthlyModal(false);
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const deleteLine = async (lineId) => {
    const confirmed = window.confirm("Supprimer cette ligne ?");
    if (!confirmed) return;
    try {
      await deleteLigneOtp(lineId);
      await refreshBudget();
    } catch (e) {
      alert(e?.message || "Erreur API âŒ");
    }
  };

  const syncGasoilSectionToBudget = async () => {
    if (!isGasoilSection) return;
    if (!activeScope) {
      throw new Error("Veuillez sélectionner un scope.");
    }

    const section = await ensureActiveSectionInScope("GASOIL");
    if (!section) {
      throw new Error("Section Gasoil non disponible.");
    }

    const rowsToPersist = gasoilRows.map((row) => {
      const draft = inlineLineDrafts[row.id] || {};
      const rowPriceRaw = draft.prixPerL ?? row.prixPerL;
      const effectivePriceRaw =
        rowPriceRaw === "" || rowPriceRaw == null
          ? null
          : Number(rowPriceRaw);
      return cloneGasoilRowSnapshot({
        ...row,
        heuresMarche: draft.heuresMarche ?? row.heuresMarche,
        consommationLH: draft.consommationLH ?? row.consommationLH,
        prixPerL: effectivePriceRaw,
      });
    });

    if (!rowsToPersist.length) {
      return;
    }

    const existingLines = collectSectionLines(activeScope, "GASOIL");
    for (const line of existingLines) {
      await deleteLigneOtp(line.id);
    }

    const gasoilSection = section;

    const subsectionsByName = new Map(
      (gasoilSection.sous_sections || []).map((item) => [item.nom, item])
    );

    for (const row of rowsToPersist) {
      const targetSousSectionName = row.subsection || row.catalogueEntry?.sousSection || "Gasoil";
      let targetSousSection = subsectionsByName.get(targetSousSectionName) || null;

      if (!targetSousSection) {
        targetSousSection = await createSousSection(gasoilSection.id, { nom: targetSousSectionName });
        subsectionsByName.set(targetSousSectionName, targetSousSection);
      }

      await createLigneOtp(targetSousSection.id, serializeGasoilRowToPayload(row));
    }
  };

  const onSave = async () => {
    if (!budget?.id) return;
    try {
      if (isGasoilSection) {
        await syncGasoilSectionToBudget();
      }
      await recalculateBudget(budget.id);
      const updated = await refreshBudget();
      if (updated) {
        setBudget(updated);
        setScopes(Array.isArray(updated?.scopes) ? updated.scopes : []);
      }
      setLastSavedAt(new Date().toLocaleString());
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const onValidate = async () => {
    if (!budget?.id) return;
    try {
      const updated = await validateBudget(budget.id);
      setBudget(updated);
      alert("Section validée ✅");
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const openMonthlyModal = (mode = "create", line = null) => {
    setModalMode(mode);
    setModalHasUserChanges(false);
    if (mode !== "edit") {
      setLineSectionOverride("");
    }
    setEditingLineId(mode === "edit" ? line?.id || null : null);
    const yearsFromLine = line
      ? Object.keys(detailsToYearState(line.detailsMensuels || {})).map(Number)
      : [];
    const initialYears = Array.from(
      new Set([...(scopeYears.length ? scopeYears : [new Date().getFullYear()]), ...yearsFromLine])
    ).sort((a, b) => a - b);

    if (line) {
      setModalYears(initialYears.map((year) => Number(year)));
      setActiveModalYear(String(initialYears[0]));
      const nextDraft = detailsToYearState(line.detailsMensuels || []);
      setMonthlyQtyDraftByYear(nextDraft);
      lineFormRef.current.monthlyQtyDraftByYear = nextDraft;
      lineFormRef.current.monthlyQtyByYear = {};
      applyLineToForm(line);
    } else {
      const currentDraft = monthlyQtyDraftByYear;
      const currentYears = Object.keys(currentDraft || {}).length
        ? Object.keys(currentDraft).map(Number).sort((a, b) => a - b)
        : initialYears.map((year) => Number(year));
      const draft =
        Object.keys(currentDraft || {}).length > 0
          ? currentDraft
          : currentYears.reduce((acc, year) => {
              acc[year] = emptyMonthlyQty();
              return acc;
            }, {});
      setMonthlyQtyDraftByYear(draft);
      lineFormRef.current.monthlyQtyDraftByYear = draft;
      setModalYears(currentYears);
      setActiveModalYear(String(currentYears[0] || initialYears[0] || new Date().getFullYear()));
    }
    setShowMonthlyModal(true);
  };

  const modalQty = monthlyQtyDraftByYear[Number(activeModalYear)] || emptyMonthlyQty();
  const totalDaysInModal = sumYearState({ [activeModalYear]: modalQty });
  const activeEditingLine = useMemo(
    () =>
      filteredLines.find((line) => Number(line?.id || 0) === Number(editingLineId || 0)) || null,
    [filteredLines, editingLineId]
  );
  const monthlyAmountsInModal = MONTHS.map((m) => {
    const qty = Number(modalQty[m.key] || 0);
    const fallbackGross = roundAmount(qty * Number(pu || 0) * Math.max(0, Number(quantite || 0)));
    const fallbackNet = roundAmount(fallbackGross * (1 - normalizeDiscountRate(remise) / 100));

    const shouldUseBackendValues =
      isMaterialSection &&
      (modalMode === "view" || (modalMode === "edit" && !modalHasUserChanges)) &&
      activeEditingLine;

    if (shouldUseBackendValues) {
      const detail = (activeEditingLine.detailsMensuels || []).find(
        (item) =>
          Number(item?.annee || 0) === Number(activeModalYear || 0) &&
          Number(item?.mois || 0) === Number(m.month)
      );
      if (detail) {
        const apiGross = Number(detail?.montant_brut);
        const apiNet = Number(detail?.montant_net);
        return {
          ...m,
          qty,
          gross: Number.isFinite(apiGross) ? apiGross : fallbackGross,
          net: Number.isFinite(apiNet) ? apiNet : fallbackNet,
        };
      }
    }

    return { ...m, qty, gross: fallbackGross, net: fallbackNet };
  });
  const materialFallbackNetByMonth = buildNetAmountsFromGross(
    monthlyAmountsInModal.map((entry) => entry.gross),
    remise
  );
  const monthlyAmountsWithNet = monthlyAmountsInModal.map((entry, index) => ({
    ...entry,
    net:
      isMaterialSection && (!activeEditingLine || !(modalMode === "view" || (modalMode === "edit" && !modalHasUserChanges)))
        ? materialFallbackNetByMonth[index] ?? 0
        : entry.net,
  }));
  const grossInModal = monthlyAmountsWithNet.reduce((sum, m) => sum + m.gross, 0);
  const netInModal = isMaterialSection
    ? roundAmount(grossInModal * (1 - normalizeDiscountRate(remise) / 100))
    : monthlyAmountsWithNet.reduce((sum, m) => sum + m.net, 0);
  const modalTitle =
    modalMode === "view"
      ? "Consulter les jours/mois"
      : modalMode === "edit"
      ? "Modifier la ligne"
      : "Remplir les jours/mois";

  const onConfirmMonthlyModal = async () => {
    const totalDaysInDraft = sumYearState(monthlyQtyDraftByYear);
    if (modalMode !== "view" && totalDaysInDraft <= 0) {
      alert("Veuillez remplir au moins une case dans les jours/mois.");
      return;
    }
    if (modalMode === "edit" && editingLineId) {
      await addLine(monthlyQtyDraftByYear);
      return;
    }
    if (modalMode === "edit" || modalMode === "create") {
      const nextQty = { ...monthlyQtyDraftByYear };
      lineFormRef.current.monthlyQtyByYear = nextQty;
      lineFormRef.current.monthlyQtyDraftByYear = nextQty;
      setMonthlyQtyByYear(nextQty);
    }
    setShowMonthlyModal(false);
    setLineSectionOverride("");
  };

  const addModalYearSlot = () => {
    const currentIndex = modalYears.indexOf(Number(activeModalYear));
    const nextYear = modalYears[currentIndex + 1] || modalYears[modalYears.length - 1] + 1;
    setModalYears((prev) => (prev.includes(nextYear) ? prev : [...prev, nextYear]));
    setMonthlyQtyDraftByYear((prev) => {
      return {
        ...prev,
        [nextYear]: emptyMonthlyQty(),
      };
    });
    setActiveModalYear(String(nextYear));
  };

  const removeModalYearSlot = () => {
    if (modalYears.length <= 1) return;
    const currentYear = Number(activeModalYear);
    const fallbackYear = modalYears.find((year) => year !== currentYear) || modalYears[0];
    setModalYears((prev) => prev.filter((year) => year !== currentYear));
    setMonthlyQtyDraftByYear((prev) => {
      const next = { ...prev };
      delete next[currentYear];
      return next;
    });
    setActiveModalYear(String(fallbackYear));
  };

  const onCancelMonthlyModal = () => {
    setEditingLineId(null);
    setShowMonthlyModal(false);
    setLineSectionOverride("");
  };

  if (isGasoilSection) {
    return (
      <div className="budget-page gasoil-page">
        <div className="budget-top-tabs">
          {SECTION_OPTIONS.map((s) => {
            const Icon = SECTION_TAB_ICONS[s.code] || FiLayers;
            if (s.code === "MASSE_SALARIALE") {
              return (
                <div key={s.code}>
                  <button
                    ref={salaryTabButtonRef}
                    type="button"
                    className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
                    onClick={toggleSalaryPanel}
                  >
                    <Icon aria-hidden="true" />
                    {s.label}
                    <FiChevronDown
                      aria-hidden="true"
                      style={{
                        marginLeft: 6,
                        transform: salaryDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s ease",
                      }}
                    />
                  </button>
                </div>
              );
            }
            return (
              <button
                key={s.code}
                type="button"
                className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
                onClick={() => {
                  setActiveSection(s.code);
                  setSalaryDropdownOpen(false);
                }}
              >
                <Icon aria-hidden="true" />
                {s.label}
              </button>
            );
          })}
        </div>
        {salaryDropdownOpen && (
          <div
            style={{
              position: "fixed",
              top: salaryDropdownPosition.top,
              left: salaryDropdownPosition.left,
              width: 260,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,250,255,0.98) 100%)",
              border: "1px solid rgba(148, 163, 184, 0.28)",
              borderRadius: 14,
              boxShadow: "0 18px 40px rgba(2, 6, 23, 0.2)",
              backdropFilter: "blur(6px)",
              padding: 10,
              zIndex: 2000,
            }}
          >
            <button
              type="button"
              className="btn-sm"
              onClick={() => selectSalaryInterface("M")}
              style={{ ...salaryDropdownButtonStyle(salaryInterface === "M"), marginBottom: 6 }}
            >
              Mensuel
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={() => selectSalaryInterface("H")}
              style={salaryDropdownButtonStyle(salaryInterface === "H")}
            >
              Horaire
            </button>
          </div>
        )}
        <div className="budget-content gasoil-content">
          <div className="budget-sidebar">
            <div className="budget-card-title budget-card-title-with-action">
              <div className="budget-card-title-main">
                <FiGrid aria-hidden="true" />
                <span>Scopes</span>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary icon-btn scope-edit-btn"
                onClick={goToProjectEditor}
                title="Modifier le projet"
                aria-label="Modifier le projet"
              >
                <FiEdit aria-hidden="true" />
              </button>
            </div>
            {!!activeScope && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  onClick={goPrevScope}
                  disabled={activeScopeIndex <= 0}
                >
                  ◀
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {activeScope.nom}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    Scope {activeScopeIndex + 1} / {scopes.length} -{" "}
                    <b>{formatAmount(activeSectionScopeTotal)} DH</b>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  onClick={goNextScope}
                  disabled={activeScopeIndex >= scopes.length - 1}
                >
                  ▶
                </button>
              </div>
            )}
            <div className="budget-scope-list">
              {loading && <div>Chargement...</div>}
              {!loading && error && <div style={{ color: "crimson" }}>{error}</div>}
              {!loading && !error && scopes.length === 0 && (
                <div>
                  Aucun scope.
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                    Ajoute les scopes dans <b>Créer projet</b>, puis reviens ici.
                  </div>
                </div>
              )}
              {scopes.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  className={`budget-scope-item ${
                    activeScopeId === z.id ? "active" : ""
                  }`}
                  onClick={() => setActiveScopeId(z.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>{z.nom}</span>
                    <b>{formatAmount(getSectionScopeTotal(z, activeSection))} DH</b>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div id="main-content" className="budget-main gasoil-main">
            <div className="budget-form-card gasoil-toolbar-card">
              <div className="budget-form-row budget-form-row-top gasoil-toolbar-row">
                <div className="budget-field-group budget-field-group-wide">
                  <label className="budget-label">Article</label>
                  <div className="article-input-wrap">
                    <input
                      type="text"
                      value={gasoilArticleQuery}
                      onChange={(e) => setGasoilArticleQuery(e.target.value)}
                      placeholder="Rechercher un article"
                      aria-label="Rechercher un article Gasoil"
                    />
                    <span className="article-filter-btn" aria-hidden="true">
                      <FiSearch aria-hidden="true" />
                    </span>
                  </div>
                </div>
                <div className="budget-field-group gasoil-price-group">
                  <label className="budget-label">Prix de L en DH</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={gasoilPricePerL}
                    onChange={(e) => handleGasoilPricePerLChange(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="budget-table-wrap">
              <div className="budget-section-heading budget-section-heading-table">
                <FiTable aria-hidden="true" />
                <span>Tableau Gasoil</span>
              </div>
              <table className="table budget-table budget-table-head gasoil-table">
                <colgroup>
                  {GASOIL_TABLE_COLUMN_WIDTHS.map((width, index) => (
                    <col key={`gasoil-head-col-${index}`} style={{ width }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th>
                      <span className="budget-th-label">
                        <FiLayers aria-hidden="true" />
                        <span>Sous section</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiFile aria-hidden="true" />
                        <span>Article</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiTool aria-hidden="true" />
                        <span>Nombre de matériels</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiCalendar aria-hidden="true" />
                        <span>Total des jours</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiCalendar aria-hidden="true" />
                        <span>Heures marche</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiDroplet aria-hidden="true" />
                        <span>Consommation L/H</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiTrendingUp aria-hidden="true" />
                        <span>Consommation journalière en L</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiDollarSign aria-hidden="true" />
                        <span>Prix de L en DH</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiTrendingUp aria-hidden="true" />
                        <span>Montant total</span>
                      </span>
                    </th>
                    <th>
                      <span className="budget-th-label">
                        <FiTable aria-hidden="true" />
                        <span>Détail des montants</span>
                      </span>
                    </th>
                  </tr>
                </thead>
              </table>
              <div className="budget-table-scroll">
                <table className="table budget-table budget-table-body gasoil-table">
                  <colgroup>
                    {GASOIL_TABLE_COLUMN_WIDTHS.map((width, index) => (
                      <col key={`gasoil-body-col-${index}`} style={{ width }} />
                    ))}
                  </colgroup>
                  <tbody>
                    {filteredGasoilRows.map((row) => (
                      <tr key={`${row.id}-${row.article}`}>
                        <td>{row.subsection || "-"}</td>
                        <td>{row.article}</td>
                        <td className="table-num-cell">{formatAmount(row.nombreMateriels)}</td>
                        <td className="table-num-cell">{formatAmount(row.nombreJours)}</td>
                        <td className="table-num-cell">
                          {activeSection === "GASOIL" ? (
                            <input
                              className="table-inline-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(getInlineLineValue(row.id, "heuresMarche", row.heuresMarche ?? 0))}
                              onChange={(e) => setInlineLineField(row.id, "heuresMarche", e.target.value)}
                              onBlur={() => saveInlineLineEdit("GASOIL", row)}
                            />
                          ) : (
                            formatAmount(row.heuresMarche)
                          )}
                        </td>
                        <td className="table-num-cell">
                          {activeSection === "GASOIL" ? (
                            <input
                              className="table-inline-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(getInlineLineValue(row.id, "consommationLH", row.consommationLH ?? 0))}
                              onChange={(e) => setInlineLineField(row.id, "consommationLH", e.target.value)}
                              onBlur={() => saveInlineLineEdit("GASOIL", row)}
                            />
                          ) : (
                            formatAmount(row.consommationLH)
                          )}
                        </td>
                        <td className="table-num-cell">
                          {formatAmount(
                            Number(getInlineLineValue(row.id, "heuresMarche", row.heuresMarche ?? 0) || 0) *
                              Number(getInlineLineValue(row.id, "consommationLH", row.consommationLH ?? 0) || 0)
                          )}
                        </td>
                        <td>
                          {activeSection === "GASOIL" ? (
                            <input
                              className="table-inline-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={String(
                                getInlineLineValue(
                                  row.id,
                                  "prixPerL",
                                  row.prixPerL ?? ""
                                )
                              )}
                              onChange={(e) => setInlineLineField(row.id, "prixPerL", e.target.value)}
                              onBlur={() => saveInlineLineEdit("GASOIL", row)}
                            />
                          ) : (
                            formatOptionalAmount(row.prixPerL)
                          )}
                        </td>
                        <td>
                          <b>
                            {formatAmount(
                              Number(row.nombreJours || 0) *
                                Number(row.nombreMateriels || 0) *
                              Number(getInlineLineValue(row.id, "heuresMarche", row.heuresMarche ?? 0) || 0) *
                              Number(getInlineLineValue(row.id, "consommationLH", row.consommationLH ?? 0) || 0) *
                                Number(
                                  getInlineLineValue(
                                    row.id,
                                    "prixPerL",
                                    row.prixPerL ?? ""
                                  ) || 0
                                )
                            )}{" "}
                            DH
                          </b>
                        </td>
                        <td>
                          <div className="line-action-group">
                            <button
                              type="button"
                              className="btn-sm line-view-btn inline-action-btn"
                              onClick={() => openGasoilDetailModal(row)}
                            >
                              <FiEye aria-hidden="true" />
                              <span>Consulter le détail</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredGasoilRows.length === 0 && (
                      <tr>
                        <td colSpan={10}>Aucune ligne Gasoil pour ce scope.</td>
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
          </div>
        </div>

        {false && gasoilDetailLine && (
          <div className="gasoil-modal-backdrop">
            <div className="gasoil-modal">
              <div className="gasoil-modal-header">
                <h4>Détail des montants</h4>
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  onClick={() => {
                    setShowGasoilDetailModal(false);
                    setGasoilDetailLine(null);
                  }}
                >
                  Fermer
                </button>
              </div>
              <div className="gasoil-modal-grid">
                <div className="gasoil-modal-card">
                  <div className="gasoil-modal-kv">
                    <span>Sous section</span>
                    <b>{gasoilDetailLine.subsection || "-"}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Article</span>
                    <b>{gasoilDetailLine.article || "-"}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Nombre jour</span>
                    <b>{formatAmount(gasoilDetailLine.nombreMateriels)}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Total des jours</span>
                    <b>{formatAmount(gasoilDetailLine.nombreJours)}</b>
                  </div>
                </div>
                <div className="gasoil-modal-card">
                  <div className="gasoil-modal-kv">
                    <span>Heures marche</span>
                    <b>{formatAmount(gasoilDetailLine.heuresMarche)}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Consommation L/H</span>
                    <b>{formatAmount(gasoilDetailLine.consommationLH)}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Consommation journalière en L</span>
                    <b>{formatAmount(gasoilDetailLine.consommationJournaliereL)}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Prix de L en DH</span>
                    <b>{formatAmount(gasoilDetailLine.prixPerL ?? gasoilPricePerL ?? 0)}</b>
                  </div>
                  <div className="gasoil-modal-total">
                    <span>Détail des montants</span>
                    <b>{formatAmount(gasoilDetailLine.montantTotal)} DH</b>
                  </div>
                </div>
              </div>
              <div className="gasoil-modal-formula">
                Nombre jour x Heures marche x Consommation L/H x Total des jours x Prix de L en DH
              </div>
            </div>
          </div>
        )}
        {showGasoilDetailModal && gasoilDetailLine && (
          <div className="gasoil-modal-backdrop">
            <div className="gasoil-modal gasoil-modal-detailed">
              <div className="gasoil-modal-header">
                <h4>Détail des montants</h4>
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  onClick={() => {
                    setShowGasoilDetailModal(false);
                    setGasoilDetailLine(null);
                    setGasoilDetailActiveYear("");
                  }}
                >
                  Fermer
                </button>
              </div>
              <div className="gasoil-modal-grid gasoil-modal-grid-detailed">
                <div className="gasoil-modal-card gasoil-modal-card-detailed">
                  <h5>Nombre jour</h5>
                  <div className="gasoil-modal-year-switch">
                    {(gasoilDetailYears.length ? gasoilDetailYears : [Number(gasoilDetailActiveYear || new Date().getFullYear())]).map(
                      (year) => (
                        <button
                          key={year}
                          type="button"
                          className={`btn-sm ${String(gasoilDetailActiveYear) === String(year) ? "" : "btn-secondary"}`}
                          onClick={() => setGasoilDetailActiveYear(String(year))}
                        >
                          {year}
                        </button>
                      )
                    )}
                  </div>
                  <table className="gasoil-modal-table">
                    <tbody>
                      {[0, 1, 2].map((rowIdx) => {
                        const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                        return (
                          <React.Fragment key={`gasoil-qty-row-${rowIdx}`}>
                            <tr>
                              {rowMonths.map((m) => (
                                <th key={`gasoil-qty-head-${m.key}`}>{m.label}</th>
                              ))}
                            </tr>
                            <tr>
                              {rowMonths.map((m) => (
                                <td key={`gasoil-qty-cell-${m.key}`}>
                                  <input type="number" value={gasoilDetailModalQty[m.key] || ""} readOnly />
                                </td>
                              ))}
                            </tr>
                          </React.Fragment>
                        );
                      })}
                  </tbody>
                  </table>
                  <div className="budget-modal-total-pill" style={{ marginTop: 10 }}>
                    <span className="gasoil-modal-emphasis-label">Total des jours: </span>
                    <b className="gasoil-modal-emphasis-value">{formatAmount(sumMonthlyQty(gasoilDetailModalQty))}</b>
                  </div>
                </div>
                <div className="gasoil-modal-card gasoil-modal-card-detailed">
                  <h5>Montant total</h5>
                  <table className="gasoil-modal-table">
                    <tbody>
                      {[0, 1, 2].map((rowIdx) => {
                        const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                        return (
                          <React.Fragment key={`gasoil-amt-row-${rowIdx}`}>
                            <tr>
                              {rowMonths.map((m) => (
                                <th key={`gasoil-amt-head-${m.key}`}>{m.label}</th>
                              ))}
                            </tr>
                            <tr>
                              {rowMonths.map((m) => {
                                const monthAmount =
                                  gasoilDetailMonthlyAmounts.find((x) => x.key === m.key)?.amount || 0;
                                return (
                                  <td key={`gasoil-amt-cell-${m.key}`}>
                                    <span>{formatAmount(monthAmount)}</span>
                                  </td>
                                );
                              })}
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="gasoil-modal-meta">
                    <div>
                      <span>Heures marche</span>
                      <b>{formatAmount(gasoilDetailLine.heuresMarche)}</b>
                    </div>
                    <div>
                      <span>Consommation L/H</span>
                      <b>{formatAmount(gasoilDetailLine.consommationLH)}</b>
                    </div>
                    <div>
                      <span>Consommation journalière en L</span>
                      <b>{formatAmount(gasoilDetailLine.consommationJournaliereL)}</b>
                    </div>
                    <div>
                      <span>Prix de L en DH</span>
                      <b>{formatAmount(gasoilDetailLine.prixPerL ?? gasoilPricePerL ?? 0)}</b>
                    </div>
                  </div>
                  <div className="budget-modal-total-pill budget-modal-total-pill-amount">
                    <span className="gasoil-modal-emphasis-label">Montant total: </span>
                    <b className="gasoil-modal-emphasis-value">{formatAmount(gasoilDetailTotalAmount)} DH</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="budget-page">
      <div className="budget-top-tabs">
        {SECTION_OPTIONS.map((s) => {
          const Icon = SECTION_TAB_ICONS[s.code] || FiLayers;
          if (s.code === "MASSE_SALARIALE") {
            return (
              <div key={s.code}>
                <button
                  ref={salaryTabButtonRef}
                  type="button"
                  className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
                  onClick={toggleSalaryPanel}
                >
                  <Icon aria-hidden="true" />
                  {s.label}
                  <FiChevronDown
                    aria-hidden="true"
                    style={{
                      marginLeft: 6,
                      transform: salaryDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </button>
              </div>
            );
          }
          return (
            <button
              key={s.code}
              type="button"
              className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
              onClick={() => {
                setActiveSection(s.code);
                setSalaryDropdownOpen(false);
              }}
            >
              <Icon aria-hidden="true" />
              {s.label}
            </button>
          );
        })}
      </div>
      {salaryDropdownOpen && (
        <div
          style={{
            position: "fixed",
            top: salaryDropdownPosition.top,
            left: salaryDropdownPosition.left,
            width: 260,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,250,255,0.98) 100%)",
            border: "1px solid rgba(148, 163, 184, 0.28)",
            borderRadius: 14,
            boxShadow: "0 18px 40px rgba(2, 6, 23, 0.2)",
            backdropFilter: "blur(6px)",
            padding: 10,
            zIndex: 2000,
          }}
        >
          <button
            type="button"
            className="btn-sm"
            onClick={() => selectSalaryInterface("M")}
            style={{ ...salaryDropdownButtonStyle(salaryInterface === "M"), marginBottom: 6 }}
          >
            Mensuel
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() => selectSalaryInterface("H")}
            style={salaryDropdownButtonStyle(salaryInterface === "H")}
          >
            Horaire
          </button>
        </div>
      )}
      <div className="budget-content">
        <div className="budget-sidebar">
          <div className="budget-card-title budget-card-title-with-action">
            <div className="budget-card-title-main">
              <FiGrid aria-hidden="true" />
              <span>Scopes</span>
            </div>
            <button
              type="button"
              className="btn-sm btn-secondary icon-btn scope-edit-btn"
              onClick={goToProjectEditor}
              title="Modifier le projet"
              aria-label="Modifier le projet"
            >
              <FiEdit aria-hidden="true" />
            </button>
          </div>
          {!!activeScope && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={goPrevScope}
                disabled={activeScopeIndex <= 0}
              >
                ◀
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {activeScope.nom}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Scope {activeScopeIndex + 1} / {scopes.length} —{" "}
                  <b>{formatAmount(activeSectionScopeTotal)} DH</b>
                </div>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={goNextScope}
                disabled={activeScopeIndex >= scopes.length - 1}
              >
                ▶
              </button>
            </div>
          )}
          <div className="budget-scope-list">
            {loading && <div>Chargement...</div>}
            {!loading && error && <div style={{ color: "crimson" }}>{error}</div>}
            {!loading && !error && scopes.length === 0 && (
              <div>
                Aucun scope.
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  Ajoute les scopes dans <b>Créer projet</b>, puis reviens ici.
                </div>
              </div>
            )}
            {scopes.map((z) => (
              <button
                key={z.id}
                type="button"
                className={`budget-scope-item ${
                  activeScopeId === z.id ? "active" : ""
                }`}
                onClick={() => setActiveScopeId(z.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{z.nom}</span>
                  <b>{formatAmount(getSectionScopeTotal(z, activeSection))} DH</b>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div id="main-content" className="budget-main">
          {isSalarySection ? (
            !salaryInterface ? (
              <></>
            ) : salaryInterface === "M" ? (
              <SalarySection
                activeScope={activeScope}
                scopeYears={scopeYears}
                ensureActiveSectionInScope={ensureActiveSectionInScope}
                refreshBudget={refreshBudget}
                activeSectionScopeTotal={activeSectionScopeTotal}
                activeSectionTotal={activeSectionTotal}
                salaryMonthlyScopeTotal={salaryMonthlyScopeTotal}
                lastSavedAt={lastSavedAt}
                onSave={onSave}
                onValidate={onValidate}
                formatAmount={formatAmount}
              />
            ) : (
              <SalarySectionHoraire
                activeScope={activeScope}
                scopeYears={scopeYears}
                ensureActiveSectionInScope={ensureActiveSectionInScope}
                refreshBudget={refreshBudget}
                activeSectionScopeTotal={activeSectionScopeTotal}
                activeSectionTotal={activeSectionTotal}
                salaryHourlyScopeTotal={salaryHourlyScopeTotal}
                lastSavedAt={lastSavedAt}
                onSave={onSave}
                onValidate={onValidate}
                formatAmount={formatAmount}
              />
            )
          ) : (
          <>
          <form className="budget-grid budget-form-card" onSubmit={handleAddSubmit} onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
              e.preventDefault();
            }
          }}>
            <div className="budget-form-row budget-form-row-top">
              <div className="budget-field-group budget-field-group-wide">
                <label className="budget-label">Sous-section</label>
                {isMaterialSection ? (
                  <div className="article-input-wrap" ref={subsectionWrapRef}>
                    <input
                      type="text"
                      value={subsectionQuery}
                      onChange={(e) => onSubsectionQueryChange(e.target.value)}
                      onClick={() => setSubsectionPickerOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.stopPropagation();
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
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label="Afficher les sous-sections"
                      title="Afficher les sous-sections"
                    >
                      {subsectionQuery ? <FiSearch aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
                    </button>
                    {subsectionPickerOpen && (
                      <div className="article-picker">
                        {filteredCatalogueSousSections.length > 0 ? (
                          filteredCatalogueSousSections.map((x) => (
                            <button
                              key={x.id || x.nom_sous_section}
                              type="button"
                              className="article-picker-item"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectSubsection(x.nom_sous_section)}
                            >
                              <span>{x.nom_sous_section}</span>
                            </button>
                          ))
                        ) : (
                          <div className="article-picker-empty">Aucune sous-section existante</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <select
                    value={subsection}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setSubsection(e.target.value);
                      lineFormRef.current.subsection = nextValue;
                      setOtpId("");
                      lineFormRef.current.otpId = "";
                      setArticle("");
                      lineFormRef.current.article = "";
                      setArticleQuery("");
                      lineFormRef.current.articleQuery = "";
                      setUnit("");
                      lineFormRef.current.unit = "";
                      setPu("");
                      lineFormRef.current.pu = "";
                      setArticlePickerOpen(false);
                    }}
                  >
                    <option value="" disabled hidden>
                      Choisir sous-section
                    </option>
                    {availableCatalogueSousSections.map((x) => (
                      <option key={x.id || x.nom_sous_section} value={x.nom_sous_section}>
                        {x.nom_sous_section}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="budget-field-group budget-field-group-wide">
                <label className="budget-label">Article</label>
                <div className="article-input-wrap" ref={articleWrapRef}>
                  <input
                    type="text"
                    value={articleQuery}
                    onChange={(e) => onArticleQueryChange(e.target.value)}
                    onClick={() => setArticlePickerOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    placeholder="Rechercher un article"
                    style={{ width: '100%', maxWidth: '100%' }}
                  />
                  <button
                    type="button"
                    className="article-filter-btn"
                    onClick={() => setArticlePickerOpen((prev) => !prev)}
                    onMouseDown={(e) => e.preventDefault()}
                    aria-label="Afficher les articles"
                    title="Afficher les articles"
                  >
                    <FiChevronDown aria-hidden="true" />
                  </button>
                  {articlePickerOpen && filteredCatalogueOtps.length > 0 && (
                    <div className="article-picker">
                      {filteredCatalogueOtps.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="article-picker-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectArticle(item)}
                        >
                          <span>{item.designation}</span>
                          <small>{item.code_otp}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="budget-form-row budget-form-row-mid">
              <div className="budget-field-group">
                <label className="budget-label">P.U</label>
                <input
                  type="number"
                  value={pu}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setPu(nextValue);
                    lineFormRef.current.pu = nextValue;
                  }}
                />
              </div>
              <div className="budget-field-group">
                <label className="budget-label">Remise (%)</label>
                <input
                  type="number"
                  value={remise}
                  min={0}
                  max={100}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setRemise('');
                      lineFormRef.current.remise = '';
                      return;
                    }
                    const n = Number(v);
                    if (Number.isNaN(n)) return;
                    const nextValue = String(Math.min(100, Math.max(0, n)));
                    setRemise(nextValue);
                    lineFormRef.current.remise = nextValue;
                  }}
                />
              </div>
            </div>

            <div className="budget-form-row budget-form-row-mid">
              <div className="budget-field-group">
                <label className="budget-label">Quantité</label>
                <input
                  type="number"
                  min={1}
                  value={quantite}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (nextValue === '') {
                      setQuantite('');
                      lineFormRef.current.quantite = '';
                      return;
                    }
                    const nextNumber = Math.max(1, Math.floor(Number(nextValue) || 1));
                    const normalized = String(nextNumber);
                    setQuantite(normalized);
                    lineFormRef.current.quantite = normalized;
                  }}
                />
              </div>
              <div className="budget-field-group budget-field-group-empty" />
            </div>

            <div className="budget-details-row">
              <label className="budget-label budget-label-inline">
                <FiTable aria-hidden="true" />
                <span>Détails des jours / montants</span>
              </label>
              <button type="button" className="btn-sm btn-secondary inline-action-btn" onClick={() => openMonthlyModal("create")}>
                <FiEdit aria-hidden="true" />
                <span>Remplir les jours/mois</span>
              </button>
            </div>

            <div className="budget-summary-bar">
              <div className="budget-summary-item">
                <FiHash aria-hidden="true" />
                <span>Total des jours</span>
                <b>{formatAmount(totalDaysFromMonthly)}</b>
              </div>
              <div className="budget-summary-item">
                <FiTrendingUp aria-hidden="true" />
                <span>Montant brut</span>
                <b>{formatAmount(currentLineGross)} DH</b>
              </div>
              <div className="budget-summary-item">
                <FiPercent aria-hidden="true" />
                <span>Remise</span>
                <b>{formatAmount(currentLineDiscount)} DH</b>
              </div>
              <div className="budget-summary-item">
                <FiDollarSign aria-hidden="true" />
                <span>Montant net</span>
                <b>{formatAmount(currentLineTotal)} DH</b>
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
                  <col key={`head-col-${index}`} style={{ width }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <span className="budget-th-label">
                      <FiLayers aria-hidden="true" />
                      <span>Sous section</span>
                    </span>
                  </th>
                  <th>
                    <span className="budget-th-label">
                      <FiFile aria-hidden="true" />
                      <span>Article</span>
                    </span>
                  </th>
                  <th>
                    <span className="budget-th-label">
                      <FiHash aria-hidden="true" />
                      <span>Quantité</span>
                    </span>
                  </th>
                  <th>
                    <span className="budget-th-label">
                      <FiDollarSign aria-hidden="true" />
                      <span>P.U</span>
                    </span>
                  </th>
                  <th>
                    <span className="budget-th-label">
                      <FiCalendar aria-hidden="true" />
                      <span>Nombre de jours</span>
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
                    <col key={`body-col-${index}`} style={{ width }} />
                  ))}
                </colgroup>
                <tbody>
                  {filteredLines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.subsection}</td>
                      <td>{l.article}</td>
                      <td className="table-num-cell">
                        {activeSection === "MATERIEL" ? (
                          <input
                            className="table-inline-input"
                            type="number"
                            min={1}
                            value={String(getInlineLineValue(l.id, "qty", l.qty ?? 1))}
                            onChange={(e) => setInlineLineField(l.id, "qty", e.target.value)}
                            onBlur={() => saveInlineLineEdit("MATERIEL", l)}
                          />
                        ) : (
                          formatAmount(l.qty)
                        )}
                      </td>
                      <td className="table-num-cell">
                        {activeSection === "MATERIEL" ? (
                          <input
                            className="table-inline-input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={String(getInlineLineValue(l.id, "pu", l.pu ?? 0))}
                            onChange={(e) => setInlineLineField(l.id, "pu", e.target.value)}
                            onBlur={() => saveInlineLineEdit("MATERIEL", l)}
                          />
                        ) : (
                          formatAmount(l.pu)
                        )}
                      </td>
                      <td className="table-num-cell">{formatAmount(l.nombreJours ?? 0)}</td>
                      <td>
                        <b>
                          {formatAmount(
                            activeSection === "MATERIEL"
                              ? roundAmount(
                                  Number(l.nombreJours ?? 0) *
                                    Number(getInlineLineValue(l.id, "qty", l.qty ?? 0) || 0) *
                                    Number(getInlineLineValue(l.id, "pu", l.pu ?? 0) || 0) *
                                    (1 - normalizeDiscountRate(l.remiseRate) / 100)
                                )
                              : l.total
                          )}
                        </b>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-sm line-view-btn inline-action-btn"
                          onClick={() => openMonthlyModal("view", l)}
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
                            onClick={() => openMonthlyModal("edit", l)}
                            title="Modifier la ligne"
                            aria-label="Modifier la ligne"
                          >
                            <FiEdit aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="line-action-btn line-duplicate-btn"
                            onClick={() => duplicateRow(l.id)}
                            title="Dupliquer la ligne"
                            aria-label="Dupliquer la ligne"
                          >
                            <FiCopy aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="line-action-btn line-delete-btn"
                            onClick={() => deleteLine(l.id)}
                            title="Supprimer la ligne"
                            aria-label="Supprimer la ligne"
                          >
                            <FiTrash aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredLines.length === 0 && (
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
          </>
          )}
        </div>
      </div>
      {showMonthlyModal && (
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
                  {modalTitle}
                </h4>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 10 }}>
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
                <table
                  className="table"
                  style={{ background: "#fff", borderRadius: 8, overflow: "hidden", flex: 1 }}
                >
                  <tbody>
                    {[0, 1, 2].map((rowIdx) => {
                      const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                      return (
                        <React.Fragment key={`qty-row-${rowIdx}`}>
                          <tr>
                            {rowMonths.map((m) => (
                              <th key={`qty-head-${m.key}`}>{m.label}</th>
                            ))}
                          </tr>
                          <tr>
                            {rowMonths.map((m) => (
                              <td key={`qty-cell-${m.key}`}>
                                {modalMode === "view" ? (
                                  formatAmount(modalQty[m.key])
                                ) : (
                                  <input
                                    type="number"
                                    min={1}
                                    max={26}
                                    value={modalQty[m.key]}
                                    onChange={(e) =>
                                      setMonthlyQtyDraftByYear((prev) => {
                                        setModalHasUserChanges(true);
                                        const next = {
                                          ...prev,
                                          [Number(activeModalYear)]: {
                                            ...(prev[Number(activeModalYear)] || emptyMonthlyQty()),
                                            [m.key]: clampMonthlyQty(e.target.value),
                                          },
                                        };
                                        lineFormRef.current.monthlyQtyDraftByYear = next;
                                        return next;
                                      })
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
                  <span className="gasoil-modal-emphasis-label">Total des jours:</span>{" "}
                  <b className="gasoil-modal-emphasis-value">{formatAmount(totalDaysInModal)}</b>
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
                <table
                  className="table"
                  style={{ background: "#fff", borderRadius: 8, overflow: "hidden", flex: 1 }}
                >
                  <tbody>
                    {[0, 1, 2].map((rowIdx) => {
                      const rowMonths = MONTHS.slice(rowIdx * 4, rowIdx * 4 + 4);
                      return (
                        <React.Fragment key={`amt-row-${rowIdx}`}>
                          <tr>
                            {rowMonths.map((m) => (
                              <th key={`amt-head-${m.key}`}>{m.label}</th>
                            ))}
                          </tr>
                          <tr>
                            {rowMonths.map((m) => {
                              const monthAmount = isMaterialSection
                                ? monthlyAmountsWithNet.find((x) => x.key === m.key)?.gross || 0
                                : monthlyAmountsWithNet.find((x) => x.key === m.key)?.gross || 0;
                              return (
                                <td key={`amt-brut-cell-${m.key}`}>
                                  {!isMaterialSection && (
                                    <>
                                      <small>Brut</small>
                                      <br />
                                    </>
                                  )}
                                  {formatAmount(monthAmount)}
                                </td>
                              );
                            })}
                          </tr>
                          {!isMaterialSection && (
                            <tr>
                              {rowMonths.map((m) => {
                                const monthAmount =
                                  monthlyAmountsWithNet.find((x) => x.key === m.key)?.net || 0;
                                return (
                                  <td key={`amt-net-cell-${m.key}`}>
                                    <small>Net</small>
                                    <br />
                                    {formatAmount(monthAmount)}
                                  </td>
                                );
                              })}
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div className="budget-modal-total-pill budget-modal-total-pill-amount">
                  <span className="gasoil-modal-emphasis-label">Total montants brut:</span>{" "}
                  <b className="gasoil-modal-emphasis-value">
                    {formatAmount(grossInModal)} DH
                  </b>
                </div>
                <div className="budget-modal-total-pill budget-modal-total-pill-amount">
                  <span className="gasoil-modal-emphasis-label">Total montants net:</span>{" "}
                  <b className="gasoil-modal-emphasis-value">{formatAmount(netInModal)} DH</b>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              {modalMode === "view" ? (
                <button type="button" className="btn-sm" onClick={onCancelMonthlyModal}>
                  Fermer
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-sm btn-secondary"
                    onClick={onCancelMonthlyModal}
                  >
                    Annuler
                  </button>
                  <button type="button" className="btn-sm" onClick={onConfirmMonthlyModal}>
                    Valider
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


