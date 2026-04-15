import { useNavigate } from "react-router-dom";

const navigate = useNavigate();

const handleSubmit = async (e) => {
  e.preventDefault();

  const data = {
    codeProjet,
    nomProjet,
    client,
    localisation,
    dateDebut,
    dateFin,
    pole,
    directeurProjet,
    typeProjet,
    dateScope,
    scopes,
    groupement,
    groupementNom,
    sections
  };

  try {
    await createProject(data);

    alert("Projet ajouté avec succès ✅");

    // 👉 REDIRECTION ICI
    navigate("/projects"); // ou "/dashboard"

  } catch (error) {
    alert("Erreur API ❌");
  }
};