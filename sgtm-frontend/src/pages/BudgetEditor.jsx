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
  deriveGasoilRows,
  parseGasoilCatalogueCsv,
  serializeGasoilRowToPayload,
  sumGasoilRows,
} from "../services/gasoil";

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

const yearStateToDetails = (yearState = {}) =>
  Object.entries(yearState).flatMap(([year, months]) =>
    MONTHS.filter((m) => Number(months?.[m.key] || 0) > 0).map((m) => ({
      mois: m.month,
      annee: Number(year),
      quantite: Number(months[m.key] || 0),
    }))
  );

const maxQtyFromDetails = (details = []) => maxYearState(detailsToYearState(details));

const maxYearState = (yearState = {}) =>
  Object.values(yearState).reduce((max, months) => {
    const yearMax = MONTHS.reduce(
      (monthMax, month) => Math.max(monthMax, Number(months?.[month.key] || 0)),
      0
    );
    return Math.max(max, yearMax);
  }, 0);

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
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "")
    .toUpperCase();

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
  "8%",
  "12%",
  "17%",
  "10%",
  "10%",
  "10%",
  "10%",
  "12%",
  "11%",
  "10%",
];

const parseUnitPrice = (value) => {
  const parsed = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseFlexibleNumber = (value) => {
  const parsed = Number(String(value || "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatAmount = (value) =>
  new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

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
  const [gasoilPriceByScopeId, setGasoilPriceByScopeId] = useState({});
  const [gasoilArticleQuery, setGasoilArticleQuery] = useState("");
  const [gasoilDetailLine, setGasoilDetailLine] = useState(null);
  const [gasoilDetailActiveYear, setGasoilDetailActiveYear] = useState("");
  const [showGasoilDetailModal, setShowGasoilDetailModal] = useState(false);

  const [subsection, setSubsection] = useState("");
  const [otpId, setOtpId] = useState("");
  const [article, setArticle] = useState("");
  const [articleQuery, setArticleQuery] = useState("");
  const [articlePickerOpen, setArticlePickerOpen] = useState(false);
  const articleWrapRef = useRef(null);
  const [unit, setUnit] = useState("");
  const [nombreJours, setNombreJours] = useState("1");
  const [pu, setPu] = useState("");
  const [remise, setRemise] = useState("");
  const [monthlyQtyByYear, setMonthlyQtyByYear] = useState({});
  const [monthlyQtyDraftByYear, setMonthlyQtyDraftByYear] = useState({});
  const [modalYears, setModalYears] = useState([]);
  const [activeModalYear, setActiveModalYear] = useState("");
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingLineId, setEditingLineId] = useState(null);
  const lineFormRef = useRef({
    subsection: "",
    otpId: "",
    article: "",
    articleQuery: "",
    unit: "",
    nombreJours: "1",
    pu: "",
    monthlyQtyByYear: {},
    monthlyQtyDraftByYear: {},
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");

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
      nombreJours,
      pu,
      monthlyQtyByYear,
      monthlyQtyDraftByYear,
    };
  }, [
    subsection,
    otpId,
    article,
    articleQuery,
    unit,
    nombreJours,
    pu,
    monthlyQtyByYear,
    monthlyQtyDraftByYear,
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
      if (!articleWrapRef.current) return;
      if (!articleWrapRef.current.contains(event.target)) {
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

  const activeGasoilPricePerL = useMemo(() => {
    if (!activeScope) return "";
    const saved = gasoilPriceByScopeId[activeScope.id];
    return saved != null ? String(saved) : "";
  }, [activeScope, gasoilPriceByScopeId]);

  useEffect(() => {
    if (activeSection !== "GASOIL") return;
    setGasoilPricePerL(activeGasoilPricePerL);
  }, [activeGasoilPricePerL, activeSection]);

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

  useEffect(() => {
    setGasoilArticleQuery("");
    if (!isGasoilSection) {
      setGasoilDetailLine(null);
      setShowGasoilDetailModal(false);
    }
  }, [isGasoilSection]);

  const materialSectionLines = useMemo(
    () => collectSectionLines(activeScope, "MATERIEL"),
    [activeScope]
  );
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

  const gasoilRows = useMemo(() => {
    if (!isGasoilSection) return [];
    const basePrice = Number(gasoilPricePerL || 0);
    return deriveGasoilRows(materialSectionLines, gasoilCatalogue, basePrice);
  }, [gasoilCatalogue, gasoilPricePerL, isGasoilSection, materialSectionLines]);

  const getSectionScopeTotal = useCallback(
    (scope, sectionCode) => {
      if (!scope) return 0;
      if (sectionCode === "GASOIL") {
        const basePrice = Number(gasoilPriceByScopeId[scope.id] || 0);
        const materialLines = collectSectionLines(scope, "MATERIEL");
        return sumGasoilRows(deriveGasoilRows(materialLines, gasoilCatalogue, basePrice));
      }
      return collectSectionLines(scope, sectionCode).reduce(
        (sum, line) => sum + Number(line?.total || 0),
        0
      );
    },
    [gasoilCatalogue, gasoilPriceByScopeId]
  );

  const activeSectionScopeTotal = useMemo(
    () => getSectionScopeTotal(activeScope, activeSection),
    [activeScope, activeSection, getSectionScopeTotal]
  );

  const activeSectionTotal = useMemo(
    () => scopes.reduce((sum, scope) => sum + getSectionScopeTotal(scope, activeSection), 0),
    [scopes, activeSection, getSectionScopeTotal]
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

  const totalQtyFromMonthly = useMemo(() => {
    return maxYearState(monthlyQtyByYear);
  }, [monthlyQtyByYear]);

  const filteredGasoilRows = useMemo(() => {
    if (!isGasoilSection) return [];
    const query = String(gasoilArticleQuery || "").trim().toLowerCase();
    if (!query) return gasoilRows;
    return gasoilRows.filter((row) =>
      [row.article, row.subsection, row.codeOtp]
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
    const nombreJours = Math.min(30, Math.max(1, Number(gasoilDetailLine?.nombreJours || 1)));
    const heuresMarche = Number(gasoilDetailLine?.heuresMarche || 0);
    const consommationLH = Number(gasoilDetailLine?.consommationLH || 0);
    const prixPerL = Number(gasoilPricePerL || gasoilDetailLine?.prixPerL || 0);
    const consommationJournaliereL = heuresMarche * consommationLH;
    return MONTHS.map((m) => {
      const qty = Number(gasoilDetailModalQty[m.key] || 0);
      const amount = qty * nombreJours * consommationJournaliereL * prixPerL;
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
        out.push({
          id: line.id,
          otp: line.code_otp,
          subsection: ss.nom,
          article: line.designation,
          unit: line.unite,
          nombreJours: line.nombre_jours ?? 1,
          pu: line.prix_unitaire,
          qty: maxQtyFromDetails(line.details_mensuels || []) || Number(line.quantite_globale || 0),
          total: line.montant_total,
          detailsQty: "consulter le détail",
          detailsAmounts: "consulter le détail",
          detailsMensuels: line.details_mensuels || [],
        });
      }
    }
    return out;
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
    setNombreJours(String(line.nombreJours ?? line.nombre_jours ?? 1));
    lineFormRef.current.nombreJours = String(line.nombreJours ?? line.nombre_jours ?? 1);
    setPu(line.pu != null ? String(line.pu) : "");
    lineFormRef.current.pu = line.pu != null ? String(line.pu) : "";
    setRemise("");
  };

  const currentLineGross = useMemo(() => {
    const p = Number(pu || 0);
    const d = Math.min(30, Math.max(1, Number(nombreJours || 1)));
    return totalQtyFromMonthly * p * d;
  }, [totalQtyFromMonthly, pu, nombreJours]);

  const currentLineTotal = useMemo(() => {
    const r = Math.min(100, Math.max(0, Number(remise || 0)));
    const discount = currentLineGross * (r / 100);
    return Math.max(0, currentLineGross - discount);
  }, [currentLineGross, remise]);

  const currentLineDiscount = useMemo(() => {
    const r = Math.min(100, Math.max(0, Number(remise || 0)));
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
          return current;
        }
        return "";
      });
      return;
    }

    if (!activeCatalogueSection) {
      setCatalogueSousSections([]);
      setSubsection("");
      return;
    }
    (async () => {
      try {
        const ss = await getCatalogueSousSections(activeCatalogueSection.id);
        const list = Array.isArray(ss) ? ss : [];
        setCatalogueSousSections(list);
        setSubsection("");
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
      if (!article) {
        setArticle(exact.designation || "");
        lineFormRef.current.article = exact.designation || "";
      }
      if (!articleQuery) {
        setArticleQuery(exact.designation || "");
        lineFormRef.current.articleQuery = exact.designation || "";
      }
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
    } else {
      setOtpId("");
      lineFormRef.current.otpId = "";
      setArticle(value);
      lineFormRef.current.article = value;
      setArticleQuery(value);
      lineFormRef.current.articleQuery = value;
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

  const ensureActiveSectionInScope = async () => {
    if (!activeScope) return null;

    const existingSection = findSectionInScope(activeScope, activeSection);
    if (existingSection) return existingSection;
    const scopeCatalogueSectionId =
      activeCatalogueSection?.id || activeScope?.section_id || catalogueSections[0]?.id;

    if (!scopeCatalogueSectionId) {
      if (visibleSections.length > 0) {
        setActiveSection(visibleSections[0].code);
      }
      return null;
    }

    await assignSectionsToScope(activeScope.id, [scopeCatalogueSectionId]);
    const refreshedBudget = await refreshBudget();
    const refreshedScopes = Array.isArray(refreshedBudget?.scopes)
      ? refreshedBudget.scopes
      : [];
    const refreshedScope =
      refreshedScopes.find((scope) => scope.id === activeScope.id) || null;

    return findSectionInScope(refreshedScope, activeSection);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await addLine();
  };

  const addLine = async (yearState = monthlyQtyByYear) => {
    const snapshot = lineFormRef.current || {};
    const effectiveYearState =
      snapshot.monthlyQtyByYear && Object.keys(snapshot.monthlyQtyByYear).length > 0
        ? snapshot.monthlyQtyByYear
        : yearState && Object.keys(yearState).length > 0
        ? yearState
        : snapshot.monthlyQtyDraftByYear && Object.keys(snapshot.monthlyQtyDraftByYear).length > 0
        ? snapshot.monthlyQtyDraftByYear
        : monthlyQtyDraftByYear;
    const q = Number(maxYearState(effectiveYearState) || 0);
    const r = Math.min(100, Math.max(0, Number(remise || 0)));
    const effectiveArticle = String(snapshot.article || snapshot.articleQuery || article || articleQuery || "").trim();
    const effectiveUnit = "Jour/Mois";
    const effectivePu = parseFlexibleNumber(snapshot.pu || pu);
    const effectiveNombreJours = Math.min(
      30,
      Math.max(1, Math.floor(Number(snapshot.nombreJours || nombreJours || 1)))
    );
    const effectiveSubsection = String(snapshot.subsection || subsection || "").trim();
    const effectiveOtpId = String(snapshot.otpId || otpId || "");

    if (!effectiveSubsection || !effectiveArticle || !effectiveUnit || !Number.isFinite(effectivePu) || q <= 0) {
      alert("Veuillez remplir l'article, le P.U et les détails des quantités.");
      return;
    }
    if (!Number.isFinite(effectiveNombreJours) || effectiveNombreJours < 1 || effectiveNombreJours > 30) {
      alert("Le nombre de jours doit être compris entre 1 et 30.");
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
      const section = await ensureActiveSectionInScope();
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
      const foundOtp = availableCatalogueOtps.find(
        (o) => String(o.id) === effectiveOtpId
      );
      const payload = {
        code_otp: foundOtp?.code_otp || "-",
        designation: effectiveArticle,
        unite: effectiveUnit,
        quantite_globale: q,
        prix_unitaire: effectivePu,
        montant_total: Number((q * effectivePu * effectiveNombreJours * (1 - r / 100)).toFixed(2)),
        nombre_jours: effectiveNombreJours,
        details_mensuels: yearStateToDetails(effectiveYearState),
      };
      if (editingLineId) {
        await updateLigneOtp(editingLineId, payload);
      } else {
        await createLigneOtp(existingSs.id, payload);
      }

      // 3) refresh budget (inclut toutes les lignes)
      await refreshBudget();

      setSubsection("");
      setArticle("");
      setArticleQuery("");
      setOtpId("");
      setUnit("Jour/Mois");
      setNombreJours("1");
      lineFormRef.current.unit = "Jour/Mois";
      lineFormRef.current.nombreJours = "1";
      setPu("");
      setRemise("");
      setMonthlyQtyByYear({});
      setMonthlyQtyDraftByYear({});
      setModalYears([]);
      setActiveModalYear("");
      setEditingLineId(null);
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

    const section = await ensureActiveSectionInScope();
    if (!section) {
      throw new Error("Section Gasoil non disponible.");
    }

    const existingLines = collectSectionLines(activeScope, "GASOIL");
    for (const line of existingLines) {
      await deleteLigneOtp(line.id);
    }

    const sectionRefresh = await refreshBudget();
    const refreshedScope =
      (Array.isArray(sectionRefresh?.scopes)
        ? sectionRefresh.scopes.find((scope) => scope.id === activeScope.id)
        : null) || activeScope;
    const gasoilSection = findSectionInScope(refreshedScope, "GASOIL") || section;
    if (!gasoilSection) {
      throw new Error("Section Gasoil introuvable après synchronisation.");
    }

    if (!gasoilRows.length) {
      return;
    }

    const subsectionsByName = new Map(
      (gasoilSection.sous_sections || []).map((item) => [item.nom, item])
    );

    for (const row of gasoilRows) {
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
      const updated = await recalculateBudget(budget.id);
      setBudget(updated);
      setScopes(Array.isArray(updated?.scopes) ? updated.scopes : []);
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
      alert("Budget validé ✅");
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const openMonthlyModal = (mode = "create", line = null) => {
    setModalMode(mode);
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
  const totalQtyInModal = maxYearState({ [activeModalYear]: modalQty });
  const monthlyAmountsInModal = MONTHS.map((m) => ({
    ...m,
    qty: Number(modalQty[m.key] || 0),
    amount:
      Number(modalQty[m.key] || 0) * Number(pu || 0) * Math.min(30, Math.max(1, Number(nombreJours || 1))),
  }));
  const grossInModal = monthlyAmountsInModal.reduce((sum, m) => sum + m.amount, 0);
  const discountInModal = grossInModal * (Math.min(100, Math.max(0, Number(remise || 0))) / 100);
  const netInModal = Math.max(0, grossInModal - discountInModal);
  const modalTitle =
    modalMode === "view"
      ? "Consulter les quantités"
      : modalMode === "edit"
      ? "Modifier la ligne"
      : "Remplir les quantités";

  const onConfirmMonthlyModal = async () => {
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
  };

  if (isGasoilSection) {
    return (
      <div className="budget-page gasoil-page">
        <div className="budget-top-tabs">
          {SECTION_OPTIONS.map((s) => (
            <button
              key={s.code}
              type="button"
              className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
              onClick={() => setActiveSection(s.code)}
            >
              {(() => {
                const Icon = SECTION_TAB_ICONS[s.code] || FiLayers;
                return <Icon aria-hidden="true" />;
              })()}
              {s.label}
            </button>
          ))}
        </div>

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

          <div className="budget-main gasoil-main">
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
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setGasoilPricePerL(nextValue);
                      if (activeScope?.id) {
                        setGasoilPriceByScopeId((prev) => ({
                          ...prev,
                          [activeScope.id]: nextValue,
                        }));
                      }
                    }}
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
                    <th>Code OTP</th>
                    <th>Sous section</th>
                    <th>Article</th>
                    <th>Nombre de matériels</th>
                    <th>Nbr Jours/Mois</th>
                    <th>Heures marche</th>
                    <th>Consommation L/H</th>
                    <th>Consommation journalière en L</th>
                    <th>Montant total</th>
                    <th>Détail des montants</th>
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
                        <td className="table-num-cell">{row.codeOtp || "-"}</td>
                        <td>{row.subsection || "-"}</td>
                        <td>{row.article}</td>
                        <td className="table-num-cell">{formatAmount(row.nombreMateriels)}</td>
                        <td className="table-num-cell">{formatAmount(row.nombreJours)}</td>
                        <td className="table-num-cell">{formatAmount(row.heuresMarche)}</td>
                        <td className="table-num-cell">{formatAmount(row.consommationLH)}</td>
                        <td className="table-num-cell">{formatAmount(row.consommationJournaliereL)}</td>
                        <td>
                          <b>{formatAmount(row.montantTotal)} DH</b>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-sm line-view-btn inline-action-btn"
                            onClick={() => openGasoilDetailModal(row)}
                          >
                            <FiEye aria-hidden="true" />
                            <span>Consulter le détail</span>
                          </button>
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
                    <span>Nombre de matériel</span>
                    <b>{formatAmount(gasoilDetailLine.nombreMateriels)}</b>
                  </div>
                  <div className="gasoil-modal-kv">
                    <span>Nbr jours/mois</span>
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
                    <b>{formatAmount(gasoilPricePerL || gasoilDetailLine.prixPerL)}</b>
                  </div>
                  <div className="gasoil-modal-total">
                    <span>Détail des montants</span>
                    <b>{formatAmount(gasoilDetailLine.montantTotal)} DH</b>
                  </div>
                </div>
              </div>
              <div className="gasoil-modal-formula">
                Nombre jours/mois x Heures marche x Consommation L/H x Nombre de matériel x Prix de L en DH
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
                  <h5>Nombre de matériel</h5>
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
                      <b>{formatAmount(gasoilPricePerL || gasoilDetailLine.prixPerL)}</b>
                    </div>
                  </div>
                  <div className="gasoil-modal-total">
                    <span>Montant total</span>
                    <b>{formatAmount(gasoilDetailTotalAmount)} DH</b>
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
        {SECTION_OPTIONS.map((s) => (
          <button
            key={s.code}
            type="button"
            className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
            onClick={() => setActiveSection(s.code)}
          >
            {(() => {
              const Icon = SECTION_TAB_ICONS[s.code] || FiLayers;
              return <Icon aria-hidden="true" />;
            })()}
            {s.label}
          </button>
        ))}
      </div>

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

        <div className="budget-main">
          <form className="budget-grid budget-form-card" onSubmit={handleAddSubmit} onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
              e.preventDefault();
            }
          }}>
            <div className="budget-form-row budget-form-row-top">
              <div className="budget-field-group budget-field-group-wide">
                <label className="budget-label">Sous-section</label>
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
                      return;
                    }
                    const n = Number(v);
                    if (Number.isNaN(n)) return;
                    const nextValue = String(Math.min(100, Math.max(0, n)));
                    setRemise(nextValue);
                  }}
                />
              </div>
            </div>

            <div className="budget-form-row budget-form-row-mid">
              <div className="budget-field-group">
                <label className="budget-label">Nombre jours/mois</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={nombreJours}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (nextValue === '') {
                      setNombreJours('');
                      lineFormRef.current.nombreJours = '';
                      return;
                    }
                    const nextNumber = Math.min(30, Math.max(1, Math.floor(Number(nextValue) || 1)));
                    const normalized = String(nextNumber);
                    setNombreJours(normalized);
                    lineFormRef.current.nombreJours = normalized;
                  }}
                />
              </div>
              <div className="budget-field-group budget-field-group-empty" />
            </div>

            <div className="budget-details-row">
              <label className="budget-label budget-label-inline">
                <FiTable aria-hidden="true" />
                <span>Détails des quantités / montants</span>
              </label>
              <button type="button" className="btn-sm btn-secondary inline-action-btn" onClick={() => openMonthlyModal("create")}>
                <FiEdit aria-hidden="true" />
                <span>Remplir les détails</span>
              </button>
            </div>

            <div className="budget-summary-bar">
              <div className="budget-summary-item">
                <FiHash aria-hidden="true" />
                <span>Quantité max</span>
                <b>{formatAmount(totalQtyFromMonthly)}</b>
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
                      <span>Quantité max</span>
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
                      <span>Nombre jours/mois</span>
                    </span>
                  </th>
                  <th>
                    <span className="budget-th-label">
                      <FiTrendingUp aria-hidden="true" />
                      <span>MontantTotal</span>
                    </span>
                  </th>
                  <th>Détail des montants</th>
                  <th>Action</th>
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
                  <td className="table-num-cell">{formatAmount(l.qty)}</td>
                  <td className="table-num-cell">{formatAmount(l.pu)}</td>
                  <td className="table-num-cell">{formatAmount(l.nombreJours ?? 1)}</td>
                  <td>
                    <b>{formatAmount(l.total)}</b>
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
                                    min={0}
                                    value={modalQty[m.key]}
                                    onChange={(e) =>
                                      setMonthlyQtyDraftByYear((prev) => {
                                        const next = {
                                          ...prev,
                                          [Number(activeModalYear)]: {
                                            ...(prev[Number(activeModalYear)] || emptyMonthlyQty()),
                                            [m.key]: e.target.value,
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
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  Quantité max: <b>{formatAmount(totalQtyInModal)}</b>
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
                              const monthAmount =
                                monthlyAmountsInModal.find((x) => x.key === m.key)?.amount || 0;
                              return <td key={`amt-cell-${m.key}`}>{formatAmount(monthAmount)}</td>;
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ textAlign: "center", marginTop: 8, color: "var(--primary-dark)" }}>
                  Total montants brut: <b>{formatAmount(grossInModal)} DH</b>
                </div>
                <div style={{ textAlign: "center", color: "var(--primary-dark)" }}>
                  Total montants net: <b>{formatAmount(netInModal)} DH</b>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>

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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
