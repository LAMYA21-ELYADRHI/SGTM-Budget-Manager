import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import "../styles.css";

const Navbar = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="navbar">
      <div className="nav-left">
        <div className="nav-burger-wrap" ref={menuRef}>
          <button
            type="button"
            className="nav-burger-btn"
            aria-label="Ouvrir le menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            ☰
          </button>
          {menuOpen && (
            <ul className="nav-burger-menu">
              <li>
                <NavLink to="/mes-projets" onClick={closeMenu}>
                  Mes projets
                </NavLink>
              </li>
              <li>
                <NavLink to="/projects" onClick={closeMenu}>
                  Vos budgets
                </NavLink>
              </li>
              <li>
                <NavLink to="/create-project" onClick={closeMenu}>
                  Créer projet
                </NavLink>
              </li>
            </ul>
          )}
        </div>
        <span>
          <b>SGTM</b>
        </span>
        <span>Budget Manager</span>
      </div>

      <div className="nav-right">
        <span>Nom Utilisateur</span>
        <img src="https://via.placeholder.com/30" alt="user" className="user-img" />
      </div>

    </div>
  );
};

export default Navbar;