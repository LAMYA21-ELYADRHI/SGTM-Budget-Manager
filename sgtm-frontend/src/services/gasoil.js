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

const splitCsvLine = (line) => String(line || "").split(";").map((part) => part.trim());

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
        subsection: sousSection.nom,
        article: line.designation,
        unit: line.unite,
        nombreJours: Number(line.nombre_jours ?? 1),
        qty: Number(line.quantite_globale ?? 0),
        pu: Number(line.prix_unitaire ?? 0),
        total: Number(line.montant_total ?? 0),
        detailsMensuels: line.details_mensuels || [],
        heuresMarche: Number(line.heures_marche ?? 0),
        consommationLH: Number(line.consommation_l_h ?? 0),
      });
    }
  }
  return out;
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
  const detailsMensuels = Array.isArray(materialLine?.detailsMensuels) ? materialLine.detailsMensuels : [];
  const basePrice = Number(pricePerL || 0);
  const montantTotal = detailsMensuels.length
    ? detailsMensuels.reduce(
        (sum, detail) =>
          sum + Number(detail?.quantite || 0) * nombreJours * consommationJournaliereL * basePrice,
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
    prixPerL: basePrice,
    montantTotal,
    catalogueEntry,
    materialLine,
    detailsMensuels,
  };
};

export const deriveGasoilRows = (materialLines, gasoilCatalogue, pricePerL) =>
  (Array.isArray(materialLines) ? materialLines : [])
    .map((line) => calculateGasoilRow(line, gasoilCatalogue, pricePerL))
    .filter((row) => row.article && (row.catalogueEntry || row.heuresMarche || row.consommationLH));

export const sumGasoilRows = (rows) =>
  (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + Number(row?.montantTotal || 0), 0);

export const serializeGasoilRowToPayload = (row) => ({
  code_otp: row?.codeOtp || "-",
  designation: row?.article || "",
  unite: "L",
  nombre_jours: Number(row?.nombreJours || 1),
  quantite_globale: Number(row?.nombreMateriels || 0),
  prix_unitaire: Number(row?.prixPerL || 0),
  montant_total: Number(row?.montantTotal || 0),
  heures_marche: Number(row?.heuresMarche || 0),
  consommation_l_h: Number(row?.consommationLH || 0),
  details_mensuels: Array.isArray(row?.detailsMensuels) ? row.detailsMensuels : [],
});
