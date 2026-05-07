const normalizeKey = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s\-.,'’/()]+/g, "")
    .toUpperCase();

const parseLocaleNumber = (value) => {
  const raw = String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseOptionalLocaleNumber = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const splitCsvLine = (line) => String(line || "").split(";").map((part) => part.trim());

const cloneDetailsMensuels = (details) =>
  Array.isArray(details)
    ? details.map((detail) => ({ ...(detail || {}) }))
    : [];

const stripDetailAmounts = (details) =>
  (Array.isArray(details) ? details : []).map((detail) => ({
    mois: Number(detail?.mois || 0),
    annee: Number(detail?.annee || 0),
    quantite: Number(detail?.quantite || 0),
  }));

const GASOIL_SOURCE_PREFIX = "MATSRC:";

const encodeSourceMaterialLineId = (value) =>
  value == null || value === "" ? "" : `${GASOIL_SOURCE_PREFIX}${String(value)}`;

const decodeSourceMaterialLineId = (value) => {
  const raw = String(value || "");
  return raw.startsWith(GASOIL_SOURCE_PREFIX) ? raw.slice(GASOIL_SOURCE_PREFIX.length) : "";
};

export const parseGasoilCatalogueCsv = (csvText) => {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(1).map((line, index) => {
    const parts = splitCsvLine(line);
    const [rawSousSection = "", rawArticle = "", , , rawHeuresMarche = "", rawConsommation = "", , rawPrixGasoil = ""] =
      parts;

    return {
      id: `gasoil-${index + 1}`,
      sousSection: rawSousSection.trim(),
      article: rawArticle.trim(),
      heuresMarche: parseLocaleNumber(rawHeuresMarche),
      consommationLH: parseLocaleNumber(rawConsommation),
      prixGasoilReference: parseLocaleNumber(rawPrixGasoil),
      key: normalizeKey(`${rawSousSection}__${rawArticle}`),
      articleKey: normalizeKey(rawArticle),
      sousSectionKey: normalizeKey(rawSousSection),
    };
  });
};

export const collectSectionLines = (scope, sectionCode) => {
  const wanted = normalizeKey(sectionCode);
  const sections = Array.isArray(scope?.sections) ? scope.sections : [];
  const match = sections.find((section) => normalizeKey(section?.nom) === wanted);
  if (!match) return [];

  const out = [];
  for (const sousSection of match.sous_sections || []) {
    for (const line of sousSection.lignes_otp || []) {
      out.push({
        id: line.id,
        codeOtp: line.code_otp,
        sourceMaterialLineId: decodeSourceMaterialLineId(line.code_otp),
        subsection: sousSection.nom,
        article: line.designation,
        unit: line.unite,
        nombreJours:
          Number(line.nombre_jours ?? 0) ||
          (Array.isArray(line.details_mensuels) && line.details_mensuels.length
            ? line.details_mensuels.reduce((sum, detail) => sum + Number(detail?.quantite || 0), 0)
            : 0) ||
          1,
        qty: Number(line.quantite_globale ?? 0),
        pu: line.prix_unitaire == null ? null : Number(line.prix_unitaire),
        total: Number(line.montant_total ?? 0),
        detailsMensuels: cloneDetailsMensuels(line.details_mensuels),
        heuresMarche: Number(line.heures_marche ?? 0),
        consommationLH: Number(line.consommation_l_h ?? 0),
      });
    }
  }
  return out.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
};

const getCatalogueEntry = (materialLine, gasoilCatalogue) => {
  const lineKey = normalizeKey(materialLine?.article);
  const subsectionKey = normalizeKey(materialLine?.subsection);
  return (
    gasoilCatalogue.find(
      (entry) =>
        entry.articleKey === lineKey &&
        (!subsectionKey || entry.sousSectionKey === subsectionKey)
    ) ||
    gasoilCatalogue.find((entry) => entry.articleKey === lineKey) ||
    null
  );
};

export const calculateGasoilRow = (materialLine, gasoilCatalogue, pricePerL) => {
  const catalogueEntry = getCatalogueEntry(materialLine, gasoilCatalogue) || {};
  const heuresMarche = Number(catalogueEntry.heuresMarche || materialLine?.heuresMarche || 0);
  const consommationLH = Number(catalogueEntry.consommationLH || materialLine?.consommationLH || 0);
  const nombreMateriels = Number(materialLine?.qty || 0);
  const nombreJours = Number(materialLine?.nombreJours || 1);
  const consommationJournaliereL = heuresMarche * consommationLH;
  const detailsMensuels = cloneDetailsMensuels(materialLine?.detailsMensuels);
  const parsedPrice = parseOptionalLocaleNumber(pricePerL);
  const basePrice = parsedPrice ?? 0;
  const montantTotal = detailsMensuels.length
    ? detailsMensuels.reduce(
        (sum, detail) =>
          sum + Number(detail?.quantite || 0) * nombreMateriels * consommationJournaliereL * basePrice,
        0
      )
    : nombreJours * consommationJournaliereL * nombreMateriels * basePrice;

  return {
    id: materialLine?.id,
    codeOtp: materialLine?.codeOtp || "-",
    subsection: materialLine?.subsection || catalogueEntry.sousSection || "",
    article: materialLine?.article || catalogueEntry.article || "",
    nombreMateriels,
    nombreJours,
    heuresMarche,
    consommationLH,
    consommationJournaliereL,
    prixPerL: parsedPrice,
    montantTotal,
    sourceMaterialLineId: materialLine?.id != null ? String(materialLine.id) : "",
    catalogueEntry: catalogueEntry ? { ...catalogueEntry } : null,
    materialLine: materialLine
      ? {
          ...materialLine,
          detailsMensuels: cloneDetailsMensuels(materialLine.detailsMensuels),
        }
      : null,
    detailsMensuels,
  };
};

export const deriveGasoilRows = (materialLines, gasoilCatalogue, pricePerL) =>
  (Array.isArray(materialLines) ? materialLines : [])
    .map((line) => calculateGasoilRow(line, gasoilCatalogue, pricePerL))
    .filter((row) => row.article);

export const sumGasoilRows = (rows) =>
  (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + Number(row?.montantTotal || 0), 0);

export const serializeGasoilRowToPayload = (row) => ({
  code_otp: encodeSourceMaterialLineId(row?.sourceMaterialLineId || row?.materialLine?.id || row?.id || row?.codeOtp || "-"),
  section: "GASOIL",
  designation: row?.article || "",
  unite: "L",
  nombre_jours: Number(row?.nombreJours || 1),
  quantite_globale: Number(row?.nombreMateriels || 0),
  prix_unitaire:
    row?.prixPerL === "" || row?.prixPerL == null ? null : Number(row?.prixPerL),
  montant_total: Number(row?.montantTotal || 0),
  heures_marche: Number(row?.heuresMarche || 0),
  consommation_l_h: Number(row?.consommationLH || 0),
  details_mensuels: stripDetailAmounts(row?.detailsMensuels),
});
