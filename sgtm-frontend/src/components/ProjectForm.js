import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createProject,
  getNextProjectCode,
  getProject,
  updateProject,
} from "../api/api";
import {
  normalizeSectionCode,
  SECTION_OPTIONS,
} from "../constants/sections";
import "../styles.css";
const PROJECT_TYPE_OPTIONS = [
  "Ferrovaire",
  "Transfert d'eau",
  "Industriel",
  "Barrage",
  "Dessalement",
];

const toDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isDateInRange = (dateValue, startValue, endValue) => {
  const date = toDateValue(dateValue);
  const start = toDateValue(startValue);
  const end = toDateValue(endValue);
  if (!date || !start || !end) return false;
  return date >= start && date <= end;
};

const buildScope = (slot, seed = {}) => {
  const sections = Array.isArray(seed.sections)
    ? seed.sections.map(normalizeSectionCode).filter(Boolean)
    : [];
  const dateDebut = seed.date_debut || seed.start_date || "";
  const dateFin = seed.date_fin || seed.end_date || "";
  return {
    slot,
    nom: seed.nom || seed.name || "",
    sections,
    date_debut: dateDebut,
    date_fin: dateFin,
    planning_slot: {
      label: `SLOT-${slot}`,
      start_date: dateDebut,
      end_date: dateFin,
    },
  };
};

const ProjectForm = () => {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [groupement, setGroupement] = useState(""); // "oui" ou "non"
  const [groupementNames, setGroupementNames] = useState([""]);
  const [scopesList, setScopesList] = useState([buildScope(1)]);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    client: "",
    pole: "",
    location: "",
    project_manager: "",
    start_date: "",
    end_date: "",
    project_type: "",
    scope_start_date: "",
    scope_end_date: "",
    sections: [],
  });

  useEffect(() => {
    if (projectId) return;
    (async () => {
      try {
        const nextCode = await getNextProjectCode();
        setFormData((prev) => ({
          ...prev,
          code: prev.code || nextCode,
        }));
      } catch (e) {
        console.error(e?.message || "Erreur API");
      }
    })();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const p = await getProject(projectId);

        setFormData((prev) => ({
          ...prev,
          code: p.code || "",
          name: p.name || "",
          client: p.client || "",
          pole: p.pole || "",
          location: p.location || "",
          project_manager: p.project_manager || "",
          start_date: p.start_date || "",
          end_date: p.end_date || "",
          project_type: p.project_type || "",
          scope_start_date: p.scope_start_date || "",
          scope_end_date: p.scope_end_date || "",
          sections:
            typeof p.sections === "string" && p.sections
              ? p.sections
                  .split(",")
                  .map((s) => normalizeSectionCode(s.trim()))
                  .filter(Boolean)
              : prev.sections,
        }));

        // groupement
        setGroupement(p.is_group ? "oui" : "non");
        try {
          const gn = p.group_names ? JSON.parse(p.group_names) : [];
          setGroupementNames(Array.isArray(gn) && gn.length ? gn : [""]);
        } catch {
          setGroupementNames([""]);
        }

        // scopes (compat: ancien format string[] ou nouveau format structuré)
        try {
          const sc = p.scope ? JSON.parse(p.scope) : [];
          if (Array.isArray(sc) && sc.length) {
            if (typeof sc[0] === "string") {
              setScopesList(sc.map((name, idx) => buildScope(idx + 1, { nom: name })));
            } else {
              setScopesList(sc.map((scope, idx) => buildScope(idx + 1, scope)));
            }
          } else {
            setScopesList([buildScope(1)]);
          }
        } catch {
          // anciens projets: scope en texte simple
          setScopesList([buildScope(1, { nom: p.scope || "" })]);
        }
      } catch (e) {
        alert(e?.message || "Erreur API ❌");
      }
    })();
  }, [projectId]);

  // Gestion des champs
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const updateScope = (index, patch) => {
    setScopesList((prev) =>
      prev.map((scope, i) => {
        if (i !== index) return scope;
        const next = { ...scope, ...patch };
        return {
          ...next,
          planning_slot: {
            ...next.planning_slot,
            label: `SLOT-${next.slot}`,
            start_date: next.date_debut || "",
            end_date: next.date_fin || "",
          },
        };
      })
    );
  };

  const toggleScopeSection = (scopeIndex, sectionCode) => {
    setScopesList((prev) =>
      prev.map((scope, idx) => {
        if (idx !== scopeIndex) return scope;
        const checked = scope.sections.includes(sectionCode);
        return {
          ...scope,
          sections: checked
            ? scope.sections.filter((s) => s !== sectionCode)
            : [...scope.sections, sectionCode],
        };
      })
    );
  };

  const addScope = () => {
    setScopesList((prev) => [...prev, buildScope(prev.length + 1)]);
  };

  const removeScope = (scopeIndex) => {
    setScopesList((prev) =>
      prev
        .filter((_, idx) => idx !== scopeIndex)
        .map((scope, idx) => buildScope(idx + 1, scope))
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation obligatoire
    if (!formData.code || !formData.name || !formData.client) {
      alert("Veuillez remplir tous les champs obligatoires !");
      return;
    }

    if (formData.start_date && formData.end_date) {
      const projectStart = toDateValue(formData.start_date);
      const projectEnd = toDateValue(formData.end_date);
      if (!projectStart || !projectEnd || projectStart > projectEnd) {
        alert("La date de début du projet doit être antérieure ou égale à la date de fin.");
        return;
      }
    }

    if (groupement === "oui") {
      const cleaned = groupementNames.map((s) => s.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        alert("Veuillez saisir au moins un nom de groupement !");
        return;
      }
    }

    try {
      const cleanedGroupNames =
        groupement === "oui"
          ? groupementNames.map((s) => s.trim()).filter(Boolean)
          : [];
      const cleanedScopes = scopesList
        .map((scope, idx) => ({
          slot: idx + 1,
          nom: String(scope.nom || "").trim(),
          sections: Array.isArray(scope.sections) ? scope.sections : [],
          date_debut: scope.date_debut || "",
          date_fin: scope.date_fin || "",
          planning_slot: {
            label: `SLOT-${idx + 1}`,
            start_date: scope.date_debut || "",
            end_date: scope.date_fin || "",
          },
        }))
        .filter((scope) => scope.nom);

      if (cleanedScopes.length === 0) {
        alert("Veuillez ajouter au moins un scope.");
        return;
      }
      if (cleanedScopes.some((scope) => !scope.date_debut || !scope.date_fin)) {
        alert("Chaque scope doit avoir une date de début et de fin.");
        return;
      }
      if (
        cleanedScopes.some((scope) => {
          const start = toDateValue(scope.date_debut);
          const end = toDateValue(scope.date_fin);
          return !start || !end || start > end;
        })
      ) {
        alert("Chaque scope doit avoir une date de début antérieure ou égale à sa date de fin.");
        return;
      }
      if (
        formData.start_date &&
        formData.end_date &&
        cleanedScopes.some(
          (scope) =>
            !isDateInRange(scope.date_debut, formData.start_date, formData.end_date) ||
            !isDateInRange(scope.date_fin, formData.start_date, formData.end_date)
        )
      ) {
        alert("Les dates des scopes doivent être incluses dans la durée du projet.");
        return;
      }

      const payload = {
        ...formData,
        is_group: groupement === "oui",
        group_names: JSON.stringify(cleanedGroupNames),
        scope: JSON.stringify(cleanedScopes),
        sections: [...new Set(cleanedScopes.flatMap((scope) => scope.sections))].join(","),
      };

      if (projectId) {
        await updateProject(projectId, payload);
        alert("Projet modifié !");
      } else {
        await createProject(payload);
        alert("Projet ajouté !");
      }

      navigate("/projects");
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  return (
    <div className="container">
      <div className="title">Créer un nouveau projet</div>

      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          {/* LEFT */}
          <div className="column">
            <div className="form-group">
              <label>Code projet *</label>
              <input
                name="code"
                value={formData.code}
                onChange={handleChange}
                readOnly={!projectId}
              />
            </div>

            <div className="form-group">
              <label>Client *</label>
              <input name="client" value={formData.client} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Localisation</label>
              <input name="location" value={formData.location} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Date début *</label>
              <input
                type="date"
                name="start_date"
                value={formData.start_date}
                onChange={handleChange}
              />
            </div>

            {/* GROUPEMENT */}
            <div className="form-group">
              <label>Groupement ? *</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    name="groupement"
                    value="oui"
                    checked={groupement === "oui"}
                    onChange={(e) => {
                      setGroupement(e.target.value);
                      if (groupementNames.length === 0) setGroupementNames([""]);
                    }}
                  />{" "}
                  Oui
                </label>
                <label>
                  <input
                    type="radio"
                    name="groupement"
                    value="non"
                    checked={groupement === "non"}
                    onChange={(e) => setGroupement(e.target.value)}
                  />{" "}
                  Non
                </label>
              </div>

              {/* Champs Nom(s) du groupement si Oui */}
              {groupement === "oui" && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {groupementNames.map((val, idx) => (
                    <div key={idx} className="inline-row">
                      <input
                        type="text"
                        placeholder={`Nom du groupement ${idx + 1}`}
                        value={val}
                        onChange={(e) =>
                          setGroupementNames((arr) =>
                            arr.map((x, i) => (i === idx ? e.target.value : x))
                          )
                        }
                      />
                      <button
                        className="btn-sm icon-btn"
                        type="button"
                        title="Ajouter un champ"
                        onClick={() => setGroupementNames((arr) => [...arr, ""])}
                      >
                        +
                      </button>
                      {groupementNames.length > 1 && (
                        <button
                          className="btn-sm btn-danger icon-btn"
                          type="button"
                          title="Supprimer ce champ"
                          onClick={() =>
                            setGroupementNames((arr) => arr.filter((_, i) => i !== idx))
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Scopes *</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {scopesList.map((scope, idx) => (
                  <div key={`scope-left-${idx}`} className="scope-card">
                    <div className="inline-row" style={{ marginBottom: 8 }}>
                      <input
                        type="text"
                        placeholder={`Scope ${idx + 1}`}
                        value={scope.nom}
                        onChange={(e) => updateScope(idx, { nom: e.target.value })}
                        style={{ width: 220, padding: "7px 9px", fontSize: 13 }}
                      />
                      <button className="btn-sm icon-btn" type="button" title="Ajouter un scope" onClick={addScope}>
                        +
                      </button>
                      {scopesList.length > 1 && (
                        <button
                          className="btn-sm btn-danger icon-btn"
                          type="button"
                          title="Supprimer ce scope"
                          onClick={() => removeScope(idx)}
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 6,
                      }}
                    >
                      {SECTION_OPTIONS.map((section) => (
                        <label
                          key={`${idx}-${section.code}`}
                          style={{
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            letterSpacing: "-0.1px",
                            padding: 0,
                            margin: 0,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={scope.sections.includes(section.code)}
                            onChange={() => toggleScopeSection(idx, section.code)}
                            style={{
                              margin: 0,
                              padding: 0,
                              width: 13,
                              height: 13,
                              display: "block",
                              verticalAlign: "middle",
                            }}
                          />
                          <span style={{ margin: 0, padding: 0, lineHeight: 1 }}>
                            {section.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="column">
            <div className="form-group">
              <label>Nom du projet *</label>
              <input name="name" value={formData.name} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Pole *</label>
              <input name="pole" value={formData.pole} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Directeur du projet *</label>
              <input
                name="project_manager"
                value={formData.project_manager}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Date fin *</label>
              <input
                type="date"
                name="end_date"
                value={formData.end_date}
                onChange={handleChange}
              />
            </div>

            <div className="form-group">
              <label>Type de projet *</label>
              <select
                name="project_type"
                value={formData.project_type}
                onChange={handleChange}
              >
                <option value="">Choisir</option>
                {PROJECT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Dates des scopes *</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {scopesList.map((scope, idx) => (
                  <div
                    key={`scope-right-${idx}`}
                    style={{
                      border: "1px solid #c8d2e6",
                      borderRadius: 10,
                      padding: 10,
                      background: "#f6f8fc",
                      maxWidth: 340,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {scope.nom?.trim() || `Scope ${idx + 1}`}
                    </div>
                    <div className="inline-row">
                      <input
                        type="date"
                        value={scope.date_debut}
                        onChange={(e) => updateScope(idx, { date_debut: e.target.value })}
                        style={{ width: 150, padding: "7px 9px", fontSize: 13 }}
                      />
                      <input
                        type="date"
                        value={scope.date_fin}
                        onChange={(e) => updateScope(idx, { date_fin: e.target.value })}
                        style={{ width: 150, padding: "7px 9px", fontSize: 13 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        <div className="button-container">
          <button>{projectId ? "Enregistrer modifications" : "Ajouter projet"}</button>
        </div>
      </form>
    </div>
  );
};

export default ProjectForm;
