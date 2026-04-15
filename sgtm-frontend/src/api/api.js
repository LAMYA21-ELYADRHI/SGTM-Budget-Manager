import axios from "axios";

const API_URL = "http://127.0.0.1:8000";

const emptyToNull = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
};

const apiErrorMessage = (error) => {
  const data = error?.response?.data;
  if (!data) return error?.message || "Erreur API";
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;
  if (Array.isArray(data?.detail)) {
    // FastAPI validation errors
    return data.detail
      .map((e) => e?.msg || e?.message || JSON.stringify(e))
      .filter(Boolean)
      .join(" | ");
  }
  try {
    return JSON.stringify(data);
  } catch {
    return "Erreur API";
  }
};

export const createProject = async (projectData) => {
  try {
    // Le backend attend exactement ces champs (schemas `ProjectCreate`)
    // On supporte aussi d'anciens noms (codeProjet, nomProjet, ...) si existants.
    const cleanData = {
      code: projectData.code ?? projectData.codeProjet ?? "",
      name: projectData.name ?? projectData.nomProjet ?? "",
      client: projectData.client ?? "",
      pole: projectData.pole ?? "",
      location: projectData.location ?? projectData.localisation ?? "",
      project_manager:
        projectData.project_manager ?? projectData.directeurProjet ?? "",
      start_date: projectData.start_date ?? projectData.dateDebut ?? "",
      end_date: projectData.end_date ?? projectData.dateFin ?? "",
      is_group: projectData.is_group ?? projectData.groupement ?? false,
      is_validated: projectData.is_validated ?? false,
      group_names: projectData.group_names ?? "",
      scope: projectData.scope ?? projectData.scopes ?? "",
      project_type: projectData.project_type ?? projectData.typeProjet ?? "",
      scope_date: emptyToNull(projectData.scope_date ?? projectData.dateScope ?? ""),
      scope_start_date: emptyToNull(projectData.scope_start_date ?? ""),
      scope_end_date: emptyToNull(projectData.scope_end_date ?? ""),
    };
    console.log('📤 API data:', cleanData);

    const response = await axios.post(`${API_URL}/projects`, cleanData);
    console.log('✅ API response:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ API error:', error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const getProjects = async () => {
  try {
    const response = await axios.get(`${API_URL}/projects`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const updateProject = async (projectId, projectData) => {
  try {
    const response = await axios.put(
      `${API_URL}/projects/${projectId}`,
      projectData
    );
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const deleteProject = async (projectId) => {
  try {
    const response = await axios.delete(`${API_URL}/projects/${projectId}`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const validateProject = async (projectId) => {
  try {
    const response = await axios.patch(`${API_URL}/projects/${projectId}/validate`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const getProject = async (projectId) => {
  try {
    const response = await axios.get(`${API_URL}/projects/${projectId}`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

// =========================
// Budget API
// =========================
export const getOrCreateBudget = async (projectId) => {
  try {
    const response = await axios.get(`${API_URL}/projects/${projectId}/budget`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const listScopes = async (budgetId) => {
  try {
    const response = await axios.get(`${API_URL}/budgets/${budgetId}/scopes`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const createScope = async (budgetId, { nom }) => {
  try {
    const response = await axios.post(`${API_URL}/budgets/${budgetId}/scopes`, {
      nom,
    });
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const deleteScope = async (scopeId) => {
  try {
    const response = await axios.delete(`${API_URL}/scopes/${scopeId}`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const getCatalogueSections = async () => {
  try {
    const response = await axios.get(`${API_URL}/catalogue/sections/`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const getCatalogueSousSections = async (sectionId) => {
  try {
    const response = await axios.get(
      `${API_URL}/catalogue/sections/${sectionId}/sous-sections`
    );
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const getCatalogueOtps = async (sousSectionId) => {
  try {
    const response = await axios.get(
      `${API_URL}/catalogue/sous-sections/${sousSectionId}/otps`
    );
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const assignSectionsToScope = async (scopeId, catalogueIds) => {
  try {
    const response = await axios.post(`${API_URL}/scopes/${scopeId}/sections`, catalogueIds);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const createSousSection = async (sectionId, { nom }) => {
  try {
    const response = await axios.post(`${API_URL}/sections/${sectionId}/sous-sections`, {
      nom,
    });
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const deleteSousSection = async (sousSectionId) => {
  try {
    const response = await axios.delete(`${API_URL}/sous-sections/${sousSectionId}`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const listSectionLignes = async (sectionId) => {
  try {
    const response = await axios.get(`${API_URL}/sections/${sectionId}/lignes`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const createLigneOtp = async (sousSectionId, ligne) => {
  try {
    const response = await axios.post(`${API_URL}/sous-sections/${sousSectionId}/lignes-otp`, ligne);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const updateLigneOtp = async (ligneId, ligne) => {
  try {
    const response = await axios.put(`${API_URL}/lignes-otp/${ligneId}`, ligne);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const deleteLigneOtp = async (ligneId) => {
  try {
    const response = await axios.delete(`${API_URL}/lignes-otp/${ligneId}`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const recalculateBudget = async (budgetId) => {
  try {
    const response = await axios.post(`${API_URL}/budgets/${budgetId}/recalculate`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};

export const validateBudget = async (budgetId) => {
  try {
    const response = await axios.patch(`${API_URL}/budgets/${budgetId}/validate`);
    return response.data;
  } catch (error) {
    console.error("❌ API error:", error.response?.data || error.message);
    throw new Error(apiErrorMessage(error));
  }
};