import { Header } from "@/components/header"
import { DashboardContent } from "../components/dashboard-content"
import { Footer } from "@/components/footer"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="flex-1">
        <DashboardContent />
      </main>
      <Footer />
    </div>
  )
}
