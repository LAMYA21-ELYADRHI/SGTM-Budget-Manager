import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import "../styles.css";
import {
  assignSectionsToScope,
  createLigneOtp,
  createSousSection,
  getCatalogueOtps,
  getCatalogueSections,
  getCatalogueSousSections,
  getOrCreateBudget,
  recalculateBudget,
  validateBudget,
} from "../api/api";

const SECTIONS = [
  { code: "INSTALLATION", label: "INSTALLATION" },
  { code: "HSE", label: "HSE" },
  { code: "MASSE_SALARIALE", label: "MASSE SALARIALE" },
  { code: "MATERIEL", label: "MATÉRIEL" },
  { code: "GASOIL", label: "GASOIL" },
  { code: "SOUSTRAITANCE", label: "SOUS TRAITANCE" },
  { code: "FOURNITURES", label: "FOURNITURES" },
  { code: "AUTRES", label: "AUTRES CHARGES" },
];
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

const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "")
    .toUpperCase();

const findSectionInScope = (scope, activeSectionCode) => {
  const wanted = normalize(activeSectionCode);
  const label = SECTIONS.find((x) => x.code === activeSectionCode)?.label;
  const wantedLabel = normalize(label);
  const sections = scope?.sections || [];

  return (
    sections.find((s) => normalize(s.nom) === wanted) ||
    sections.find((s) => normalize(s.nom) === wantedLabel) ||
    null
  );
};

export default function BudgetEditor() {
  const { projectId } = useParams();
  const [activeSection, setActiveSection] = useState(SECTIONS[3].code);
  const [activeScopeId, setActiveScopeId] = useState(null);

  const [budget, setBudget] = useState(null);
  const [scopes, setScopes] = useState([]);
  const [catalogueSections, setCatalogueSections] = useState([]);
  const [catalogueSousSections, setCatalogueSousSections] = useState([]);
  const [catalogueOtps, setCatalogueOtps] = useState([]);

  const [subsection, setSubsection] = useState("");
  const [otpId, setOtpId] = useState("");
  const [article, setArticle] = useState("");
  const [unit, setUnit] = useState("");
  const [pu, setPu] = useState("");
  const [remise, setRemise] = useState("");
  const [monthlyQty, setMonthlyQty] = useState(emptyMonthlyQty());
  const [monthlyQtyDraft, setMonthlyQtyDraft] = useState(emptyMonthlyQty());
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);
  const [modalMode, setModalMode] = useState("edit");

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
    } catch (e) {
      setError(e?.message || "Erreur API");
    } finally {
      setLoading(false);
    }
  };

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

  // Quand on change de scope (ou d'onglet), on vide les champs de saisie
  useEffect(() => {
    setMonthlyQty(emptyMonthlyQty());
    setRemise("");
    setShowMonthlyModal(false);

    // remettre PU/unité/designation sur la référence catalogue (si OTP sélectionné)
    const found = catalogueOtps.find((o) => String(o.id) === String(otpId));
    if (found) {
      setArticle(found.designation || "");
      setUnit(found.unite || "");
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

  // Si un scope n'a pas encore de sections, on l'initialise avec tout le catalogue
  useEffect(() => {
    if (!activeScope || catalogueSections.length === 0) return;
    if (Array.isArray(activeScope.sections) && activeScope.sections.length > 0) return;

    (async () => {
      try {
        await assignSectionsToScope(
          activeScope.id,
          catalogueSections.map((c) => c.id)
        );
        await refreshBudget();
      } catch (e) {
        setError(e?.message || "Erreur API (assign sections)");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScopeId, catalogueSections.length]);

  const filteredLines = useMemo(() => {
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
          pu: line.prix_unitaire,
          qty: line.quantite_globale,
          total: line.montant_total,
          detailsQty: "consulter le détail",
          detailsAmounts: "consulter le détail",
          detailsMensuels: line.details_mensuels || [],
        });
      }
    }
    return out;
  }, [activeScope, activeSection]);

  const totalQtyFromMonthly = useMemo(() => {
    return MONTHS.reduce((sum, m) => sum + Number(monthlyQty[m.key] || 0), 0);
  }, [monthlyQty]);

  const currentLineGross = useMemo(() => {
    const p = Number(pu || 0);
    return totalQtyFromMonthly * p;
  }, [totalQtyFromMonthly, pu]);

  const currentLineTotal = useMemo(() => {
    const r = Math.min(100, Math.max(0, Number(remise || 0)));
    const discount = currentLineGross * (r / 100);
    return Math.max(0, currentLineGross - discount);
  }, [currentLineGross, remise]);

  const currentLineDiscount = useMemo(() => {
    const r = Math.min(100, Math.max(0, Number(remise || 0)));
    return Math.max(0, currentLineGross * (r / 100));
  }, [currentLineGross, remise]);

  const monthlyAmounts = useMemo(() => {
    const p = Number(pu || 0);
    return MONTHS.map((m) => ({
      ...m,
      qty: Number(monthlyQty[m.key] || 0),
      amount: Number(monthlyQty[m.key] || 0) * p,
    }));
  }, [monthlyQty, pu]);

  const totalScope = useMemo(() => {
    if (!activeScope) return 0;
    return Number(activeScope.total_scope || 0);
  }, [activeScope]);

  const totalSection = useMemo(() => {
    if (!activeScope) return 0;
    const section = findSectionInScope(activeScope, activeSection);
    return Number(section?.total_section || 0);
  }, [activeScope, activeSection]);

  const activeScopeIndex = useMemo(() => {
    if (!activeScopeId) return -1;
    return scopes.findIndex((s) => s.id === activeScopeId);
  }, [scopes, activeScopeId]);

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
    const label = SECTIONS.find((x) => x.code === activeSection)?.label;
    const wantedLabel = normalize(label);
    return (
      catalogueSections.find((c) => normalize(c.nom_section) === wanted) ||
      catalogueSections.find((c) => normalize(c.nom_section) === wantedLabel) ||
      null
    );
  }, [catalogueSections, activeSection]);

  useEffect(() => {
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
        setSubsection(list[0]?.nom_sous_section || "");
      } catch (e) {
        setError(e?.message || "Erreur API (catalogue sous-sections)");
      }
    })();
  }, [activeCatalogueSection?.id]);

  useEffect(() => {
    const selected = catalogueSousSections.find((x) => x.nom_sous_section === subsection);
    if (!selected) {
      setCatalogueOtps([]);
      setOtpId("");
      setArticle("");
      return;
    }

    (async () => {
      try {
        const otps = await getCatalogueOtps(selected.id);
        const list = Array.isArray(otps) ? otps : [];
        setCatalogueOtps(list);
        const first = list[0] || null;
        setOtpId(first ? String(first.id) : "");
        setArticle(first?.designation || "");
        setUnit(first?.unite || "");
        setPu(first?.prix_unitaire_reference != null ? String(first.prix_unitaire_reference) : "");
      } catch (e) {
        setError(e?.message || "Erreur API (catalogue OTPs)");
      }
    })();
  }, [subsection, catalogueSousSections]);

  const onOtpChange = (value) => {
    setOtpId(value);
    const found = catalogueOtps.find((o) => String(o.id) === String(value));
    if (found) {
      setArticle(found.designation || "");
      setUnit(found.unite || "");
      setPu(found.prix_unitaire_reference != null ? String(found.prix_unitaire_reference) : "");
    }
  };

  const addLine = async () => {
    const q = Number(totalQtyFromMonthly || 0);
    const r = Math.min(100, Math.max(0, Number(remise || 0)));
    if (!subsection || !article || !unit || !pu || q <= 0) {
      alert("Veuillez remplir l'article, P.U et les détails des quantités.");
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

    const section = findSectionInScope(activeScope, activeSection);
    if (!section) {
      alert("Section non disponible pour ce scope.");
      return;
    }

    try {
      // 1) s'assurer que la sous-section existe dans cette section budgetaire
      let existingSs =
        (section.sous_sections || []).find((x) => x.nom === subsection) || null;
      if (!existingSs) {
        existingSs = await createSousSection(section.id, { nom: subsection });
      }

      // 2) créer la ligne OTP en DB
      const foundOtp = catalogueOtps.find((o) => String(o.id) === String(otpId));
      const payload = {
        code_otp: foundOtp?.code_otp || "-",
        designation: article,
        unite: unit,
        quantite_globale: q,
        prix_unitaire: Number(pu || 0),
        montant_total: Number(currentLineTotal.toFixed(2)),
        details_mensuels: MONTHS.filter((m) => Number(monthlyQty[m.key] || 0) > 0).map((m) => ({
          mois: m.month,
          annee: new Date().getFullYear(),
          quantite: Number(monthlyQty[m.key] || 0),
        })),
      };
      await createLigneOtp(existingSs.id, payload);

      // 3) refresh budget (inclut toutes les lignes)
      await refreshBudget();

      setMonthlyQty(emptyMonthlyQty());
      setRemise("");
      setShowMonthlyModal(false);
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const onSave = async () => {
    if (!budget?.id) return;
    try {
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

  const openMonthlyModal = (mode = "edit", line = null) => {
    setModalMode(mode);
    if (mode === "view" && line) {
      const map = emptyMonthlyQty();
      for (const d of line.detailsMensuels || []) {
        const found = MONTHS.find((m) => m.month === d.mois);
        if (found) map[found.key] = String(d.quantite || 0);
      }
      setMonthlyQtyDraft(map);
    } else {
      setMonthlyQtyDraft({ ...monthlyQty });
    }
    setShowMonthlyModal(true);
  };

  const modalQty = modalMode === "edit" ? monthlyQtyDraft : monthlyQtyDraft;
  const totalQtyInModal = MONTHS.reduce(
    (sum, m) => sum + Number(modalQty[m.key] || 0),
    0
  );
  const monthlyAmountsInModal = MONTHS.map((m) => ({
    ...m,
    qty: Number(modalQty[m.key] || 0),
    amount: Number(modalQty[m.key] || 0) * Number(pu || 0),
  }));
  const grossInModal = monthlyAmountsInModal.reduce((sum, m) => sum + m.amount, 0);
  const discountInModal = grossInModal * (Math.min(100, Math.max(0, Number(remise || 0))) / 100);
  const netInModal = Math.max(0, grossInModal - discountInModal);

  const onConfirmMonthlyModal = () => {
    if (modalMode === "edit") {
      setMonthlyQty({ ...monthlyQtyDraft });
    }
    setShowMonthlyModal(false);
  };

  const onCancelMonthlyModal = () => {
    // Annulation complète: on vide les valeurs du popup et du formulaire principal
    const reset = emptyMonthlyQty();
    setMonthlyQtyDraft(reset);
    if (modalMode === "edit") {
      setMonthlyQty(reset);
    }
    setShowMonthlyModal(false);
  };

  return (
    <div className="budget-page">
      <div className="budget-top-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.code}
            type="button"
            className={`budget-tab ${activeSection === s.code ? "active" : ""}`}
            onClick={() => setActiveSection(s.code)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="budget-content">
        <div className="budget-sidebar">
          <div className="budget-card-title">Scopes</div>
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
                  <b>{Number(activeScope.total_scope || 0).toFixed(2)} DH</b>
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
                  <b>{Number(z.total_scope || 0).toFixed(2)} DH</b>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="budget-main">
          <div className="budget-grid">
            <div className="budget-block">
              <label className="budget-label">Sous-section</label>
              <select
                value={subsection}
                onChange={(e) => setSubsection(e.target.value)}
              >
                {catalogueSousSections.map((x) => (
                  <option key={x.id} value={x.nom_sous_section}>
                    {x.nom_sous_section}
                  </option>
                ))}
              </select>
            </div>

            <div className="budget-block">
              <label className="budget-label">Article</label>
              <select value={otpId} onChange={(e) => onOtpChange(e.target.value)}>
                {catalogueOtps.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.designation}
                  </option>
                ))}
              </select>

              <div className="budget-form-2col">
                <div>
                  <label className="budget-label">Ute</label>
                  <input value={unit} readOnly />
                </div>
                <div>
                  <label className="budget-label">P.U</label>
                  <input
                    type="number"
                    value={pu}
                    onChange={(e) => setPu(e.target.value)}
                  />
                </div>
              </div>

              <div className="budget-form-2col">
                <div>
                  <label className="budget-label">Remise (%)</label>
                  <input
                    type="number"
                    value={remise}
                    min={0}
                    max={100}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") {
                        setRemise("");
                        return;
                      }
                      const n = Number(v);
                      if (Number.isNaN(n)) return;
                      setRemise(String(Math.min(100, Math.max(0, n))));
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="budget-label">Détail des quantités / montants</label>
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  onClick={() => openMonthlyModal("edit")}
                >
                  Remplir les détails
                </button>
              </div>

              <div className="budget-add-row">
                <div className="budget-mini-info">
                  Quantité totale: <b>{totalQtyFromMonthly.toFixed(2)}</b>
                  {"  "}
                  <span style={{ marginLeft: 10 }}>
                    Montant brut: <b>{currentLineGross.toFixed(2)} DH</b>
                  </span>
                  <span style={{ marginLeft: 10 }}>
                    Remise: <b>{currentLineDiscount.toFixed(2)} DH</b>
                  </span>
                  <span style={{ marginLeft: 10 }}>
                    Montant net: <b>{currentLineTotal.toFixed(2)} DH</b>
                  </span>
                </div>
                <button type="button" className="btn-sm" onClick={addLine}>
                  Ajouter au tableau
                </button>
              </div>
            </div>
          </div>

          <div className="budget-table-wrap">
            <table className="table budget-table">
              <thead>
                <tr>
                  <th>Code OTP</th>
                  <th>sous section</th>
                  <th>Article</th>
                  <th>Uté</th>
                  <th>P.U</th>
                  <th>Quantité Totale</th>
                  <th>MontantTotal</th>
                  <th>Détail des quantités</th>
                  <th>Détails des montants</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.otp}</td>
                    <td>{l.subsection}</td>
                    <td>{l.article}</td>
                    <td>{l.unit}</td>
                    <td>{String(l.pu)}</td>
                    <td>{String(l.qty)}</td>
                    <td>
                      <b>{String(l.total)}</b>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-sm btn-secondary"
                        onClick={() => openMonthlyModal("view", l)}
                      >
                        {l.detailsQty}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-sm btn-secondary"
                        onClick={() => openMonthlyModal("view", l)}
                      >
                        {l.detailsAmounts}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredLines.length === 0 && (
                  <tr>
                    <td colSpan={9}>Aucune ligne pour ce scope/section.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="budget-footer">
            <div className="budget-footer-left">
              <div className="budget-saved">
                Dernière sauvegarde: <b>{lastSavedAt || "-"}</b>
              </div>
            </div>
            <div className="budget-footer-center">
              <div>
                <b>Total scope :</b> {totalScope.toFixed(2)} DH
              </div>
              <div>
                <b>Total section :</b> {totalSection.toFixed(2)} DH
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
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#f4f7ff",
              borderRadius: 16,
              width: "min(1060px, 97vw)",
              padding: 20,
            }}
          >
           
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div
                style={{
                  background: "#39459e",
                  borderRadius: 28,
                  padding: 14,
                  color: "#fff",
                }}
              >
                <h4 style={{ marginTop: 0, textAlign: "center", fontSize: 30, fontWeight: 700 }}>
                  Remplir les quantités
                </h4>
                <table className="table" style={{ background: "#fff", borderRadius: 8, overflow: "hidden" }}>
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
                                  Number(modalQty[m.key] || 0)
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    value={modalQty[m.key]}
                                    onChange={(e) =>
                                      setMonthlyQtyDraft((prev) => ({
                                        ...prev,
                                        [m.key]: e.target.value,
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
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  Total quantités: <b>{totalQtyInModal.toFixed(2)}</b>
                </div>
              </div>
              <div
                style={{
                  background: "#39459e",
                  borderRadius: 28,
                  padding: 14,
                  color: "#fff",
                }}
              >
                <h4 style={{ marginTop: 0, textAlign: "center", fontSize: 30, fontWeight: 700 }}>
                  Détails des montants
                </h4>
                <table className="table" style={{ background: "#fff", borderRadius: 8, overflow: "hidden" }}>
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
                              return <td key={`amt-cell-${m.key}`}>{monthAmount.toFixed(2)}</td>;
                            })}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  Total montants brut: <b>{grossInModal.toFixed(2)} DH</b>
                </div>
                <div style={{ textAlign: "center" }}>
                  Total montants net: <b>{netInModal.toFixed(2)} DH</b>
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

