import { Routes, Route } from "react-router-dom"
import HomePage from "./pages/HomePage"
import OrganizationsPage from "./pages/OrganizationsPage"
import TeamPage from "./pages/TeamPage"
import LoginPage from "./pages/LoginPage"

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/organizations" element={<OrganizationsPage />} />
      <Route path="/teams/:teamId" element={<TeamPage />} />
    </Routes>
  )
}

export default App
