export const SECTION_OPTIONS = [
  { code: "INSTALLATION", label: "Installation" },
  { code: "HSE", label: "HSE" },
  { code: "MASSE_SALARIALE", label: "Masse salariale" },
  { code: "MATERIEL", label: "Matériel" },
  { code: "GASOIL", label: "Gasoil" },
  { code: "SOUSTRAITANCE", label: "Sous Traitance" },
  { code: "FOURNITURES", label: "Fournitures" },
  { code: "AUTRES_CHARGES", label: "Autre charges" },
];

const SECTION_ALIASES = {
  INSTALLATION: ["S1", "Installation"],
  HSE: ["S2", "HSE"],
  MASSE_SALARIALE: ["S3", "Masse salariale", "Masse Salariale"],
  MATERIEL: ["S4", "Matériel", "Materiel"],
  GASOIL: ["S5", "Gasoil"],
  SOUSTRAITANCE: ["S6", "Sous Traitance", "Sous-traitance", "Sous-traitance"],
  FOURNITURES: ["Fournitures"],
  AUTRES_CHARGES: ["Autre charges", "Autres charges", "Autres", "Charges diverses"],
};

const normalizeSectionValue = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s-]+/g, "")
    .toUpperCase();

export const normalizeSectionCode = (value) => {
  const normalized = normalizeSectionValue(value);
  if (!normalized) return "";

  const found = SECTION_OPTIONS.find(
    (option) =>
      normalizeSectionValue(option.code) === normalized ||
      normalizeSectionValue(option.label) === normalized ||
      (SECTION_ALIASES[option.code] || []).some(
        (alias) => normalizeSectionValue(alias) === normalized
      )
  );

  return found?.code || normalized;
};

export const getSectionLabel = (code) => {
  const normalized = normalizeSectionCode(code);
  return SECTION_OPTIONS.find((option) => option.code === normalized)?.label || String(code || "");
};

export const getSectionOptionsFromValues = (values) => {
  const normalizedValues = Array.isArray(values)
    ? values.map((value) => normalizeSectionCode(value)).filter(Boolean)
    : [];

  const allowed = new Set(normalizedValues);
  if (allowed.size === 0) return [];
  return SECTION_OPTIONS.filter((option) => allowed.has(option.code));
};