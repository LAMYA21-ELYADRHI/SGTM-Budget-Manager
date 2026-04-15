import Navbar from "./components/Navbar";
import ProjectForm from "./components/ProjectForm";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Projects from "./pages/Projects";
import BudgetEditor from "./pages/BudgetEditor";
import MesProjets from "./pages/MesProjets";

function App() {
  return (
    <>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Navigate to="/mes-projets" replace />} />
          <Route path="/mes-projets" element={<MesProjets />} />
          <Route path="/create-project" element={<ProjectForm />} />
          <Route path="/create-project/:projectId" element={<ProjectForm />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/vos-budgets" element={<Navigate to="/projects" replace />} />
          <Route path="/budget/:projectId" element={<BudgetEditor />} />
          <Route path="*" element={<Navigate to="/mes-projets" replace />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;