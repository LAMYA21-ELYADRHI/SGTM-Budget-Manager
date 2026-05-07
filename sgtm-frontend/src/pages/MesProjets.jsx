import React from "react";
import { useNavigate } from "react-router-dom";
import "../styles.css";

const PROJECTS = [
  {
    id: 1,
    title: "Aeroport de Marrakech - Terminal T3",
    category: "Gares - Aeroports",
    description:
      "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsu.",
    image: "/project-1.png",
  },
  {
    id: 2,
    title: "Aeroport de Marrakech - Terminal T3",
    category: "Gares - Aeroports",
    description:
      "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsu.",
    image: "/project-2.png",
  },
  {
    id: 3,
    title: "Aeroport de Marrakech - Terminal T3",
    category: "Gares - Aeroports",
    description:
      "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsu.",
    image: "/project-3.png",
  },
];

export default function MesProjets() {
  const navigate = useNavigate();

  return (
    <div className="showcase-page">
      <div className="showcase-header">
        <h1>Réalisations majeures</h1>
        <button
          type="button"
          className="next-budgets-btn"
          onClick={() => navigate("/projects")}
          aria-label="Aller vers Mes budgets"
          title="Aller vers Mes budgets"
        >
          <span>Mes budgets</span>
          <span className="arrow">→</span>
        </button>
      </div>

      <div className="showcase-list">
        {PROJECTS.map((project, index) => (
          <article
            key={project.id}
            className={`showcase-item ${index % 2 === 1 ? "reverse" : ""}`}
          >
            <div className="showcase-text">
              <h2>{project.title}</h2>
              <h3>{project.category}</h3>
              <p>{project.description}</p>
            </div>
            <div className="showcase-image-wrap">
              <img
                src={project.image}
                alt={project.title}
                className="showcase-image"
                onError={(e) => {
                  if (e.currentTarget.src !== project.fallbackImage) {
                    e.currentTarget.src = project.fallbackImage;
                  }
                }}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}