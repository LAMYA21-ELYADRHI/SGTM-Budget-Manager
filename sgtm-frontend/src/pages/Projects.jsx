import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteProject, getProjects } from "../api/api";
import "../styles.css";
import { FiImage } from "react-icons/fi";

const STATUS_META = {
  valide: { label: "Budget validé", className: "status-valid" },
  refuse: { label: "Budget refusé", className: "status-refused" },
  en_validation: { label: "Budget en cours de validation", className: "status-review" },
  non_attribue: { label: "Budget non attribué", className: "status-unassigned" },
  en_creation: { label: "Budget en cours de création", className: "status-creation" },
};

const normalizeStatus = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const getBudgetQuantity = (project) =>
  Number(
    project?.budget_quantity ??
      project?.quantite_budget ??
      project?.budget_qty ??
      project?.quantity ??
      NaN
  );

const isTruthy = (value) => value === true || value === 1 || value === "1";

const statusLooksCompleted = (value) => {
  const normalized = normalizeStatus(value);
  return normalized.includes("termine") || normalized.includes("complete");
};

const statusLooksInValidation = (value) => {
  const normalized = normalizeStatus(value);
  return normalized.includes("validation") && !statusLooksCompleted(value);
};

const isCreationCompleted = (project) =>
  isTruthy(project?.creation_completed) ||
  isTruthy(project?.is_creation_completed) ||
  statusLooksCompleted(project?.creation_status);

const isProjectValidationCompleted = (project) =>
  isTruthy(project?.validation_completed) ||
  isTruthy(project?.is_validation_completed) ||
  statusLooksCompleted(project?.validation_status) ||
  isTruthy(project?.is_validated);

const hasAllSectionsValidated = (project) => {
  const sections =
    project?.sections ||
    project?.budget_sections ||
    project?.sections_budget ||
    project?.scope_sections ||
    [];

  if (!Array.isArray(sections) || sections.length === 0) return false;

  return sections.every(
    (section) =>
      isTruthy(section?.is_validated) ||
      isTruthy(section?.validated) ||
      statusLooksCompleted(section?.status) ||
      normalizeStatus(section?.status) === "valide"
  );
};

const isBudgetFullyValidated = (project) =>
  isCreationCompleted(project) &&
  isProjectValidationCompleted(project) &&
  hasAllSectionsValidated(project);

const resolveBudgetStatus = (project) => {
  const quantity = getBudgetQuantity(project);
  if (!Number.isNaN(quantity) && quantity === 0) return "non_attribue";

  const rawStatus = normalizeStatus(
    project?.budget_status ?? project?.status_budget ?? project?.status
  );
  if (rawStatus.includes("refus")) return "refuse";
  if (rawStatus.includes("en cours") && rawStatus.includes("validation")) {
    return "en_validation";
  }
  if (rawStatus.includes("validation")) return "en_validation";
  if (rawStatus.includes("creation")) return "en_creation";

  if (isBudgetFullyValidated(project)) return "valide";
  if (
    statusLooksInValidation(project?.validation_status) ||
    statusLooksInValidation(project?.status)
  ) {
    return "en_validation";
  }
  return "en_creation";
};

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectImages, setProjectImages] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getProjects();
        if (!mounted) return;
        setProjects(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || "Erreur API");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const status = resolveBudgetStatus(project);
      const statusMatches = statusFilter === "all" || status === statusFilter;
      if (!statusMatches) return false;

      if (!query) return true;
      const searchable = [
        project.name,
        project.code,
        project.client,
        project.location,
        project.project_type,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return searchable.includes(query);
    });
  }, [projects, search, statusFilter]);

  const onUploadImage = (projectId, file) => {
    if (!file) return;
    setProjectImages((prev) => {
      if (prev[projectId]) URL.revokeObjectURL(prev[projectId]);
      return { ...prev, [projectId]: URL.createObjectURL(file) };
    });
  };

  const onRemoveImage = (projectId) => {
    setProjectImages((prev) => {
      if (!prev[projectId]) return prev;
      URL.revokeObjectURL(prev[projectId]);
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  };

  const onDeleteProject = async (project) => {
    const confirmed = window.confirm(`Supprimer le projet "${project?.name || ""}" ?`);
    if (!confirmed) return;
    try {
      await deleteProject(project.id);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
      onRemoveImage(project.id);
    } catch (e) {
      alert(e?.message || "Erreur API ❌");
    }
  };

  const statusOptions = [
    { value: "all", label: "Tous les statuts" },
    { value: "valide", label: STATUS_META.valide.label },
    { value: "en_creation", label: STATUS_META.en_creation.label },
    { value: "en_validation", label: STATUS_META.en_validation.label },
    { value: "refuse", label: STATUS_META.refuse.label },
    { value: "non_attribue", label: STATUS_META.non_attribue.label },
  ];

  return (
    <div className="container budgets-dashboard">
      <div className="budgets-header">
        <h1 className="title">Mes budgets</h1>
      </div>

      <div className="budgets-toolbar">
        <div className="search-input-wrap">
          <span className="search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="text"
            placeholder="Rechercher un projet"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="loading-wrap">
          <div className="loader-ring" />
          <span>Chargement...</span>
        </div>
      )}
      {!loading && error && <div style={{ color: "crimson" }}>{error}</div>}

      {!loading && !error && (
        <div className="budgets-grid">
          {filteredProjects.map((p) => {
            const status = resolveBudgetStatus(p);
            const statusMeta = STATUS_META[status];
            const imageUrl = projectImages[p.id];
            return (
              <article key={p.id} className="project-card">
                <div className="project-image-wrap">
                  {imageUrl && (
                    <button
                      type="button"
                      className="project-remove-image-btn"
                      onClick={() => onRemoveImage(p.id)}
                      aria-label="Supprimer la photo"
                    >
                      ×
                    </button>
                  )}
                  {imageUrl ? (
                    <img src={imageUrl} alt={`Projet ${p.name}`} className="project-image" />
                  ) : (
                    <div className="project-image-placeholder">Ajouter une image du projet</div>
                  )}
                </div>

                <label className="btn-sm btn-secondary project-upload-btn">
                  <FiImage aria-hidden="true" />
                  <span>Image / Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onClick={(e) => {
                      e.currentTarget.value = "";
                    }}
                    onChange={(e) => {
                      onUploadImage(p.id, e.target.files?.[0]);
                      e.currentTarget.value = "";
                    }}
                    hidden
                  />
                </label>

                <div className={`project-status ${statusMeta.className}`}>{statusMeta.label}</div>

                <div className="project-card-content">
                  <p>
                    <strong>Nom du projet:</strong> {p.name || "-"}
                  </p>
                  <p>
                    <strong>Code projet:</strong> {p.code || "-"}
                  </p>
                  <p>
                    <strong>Client:</strong> {p.client || "-"}
                  </p>
                  <p>
                    <strong>Localisation:</strong> {p.location || "-"}
                  </p>
                  <p>
                    <strong>Type de projet:</strong> {p.project_type || "-"}
                  </p>
                </div>

                <div className="project-card-actions">
                  <button type="button" className="btn-sm" onClick={() => navigate(`/budget/${p.id}`)}>
                    Consulter
                  </button>
                  <button type="button" className="btn-sm btn-secondary">
                    Voir récap dashboard
                  </button>
                  {status === "en_creation" && (
                    <button
                      type="button"
                      className="btn-sm btn-danger project-delete-btn"
                      onClick={() => onDeleteProject(p)}
                    >
                      Supprimer
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          <button
            type="button"
            className="project-card project-add-card"
            onClick={() => navigate("/create-project")}
          >
            <span className="add-icon">+</span>
            <span>Créer un projet</span>
          </button>
        </div>
      )}

      {!loading && !error && filteredProjects.length === 0 && (
        <div className="empty-projects">Aucun projet ne correspond aux filtres appliqués.</div>
      )}
    </div>
  );
}
