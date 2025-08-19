import { Link } from "react-router-dom"
import { Search, Bell, Edit, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

export function Header() {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Navigation */}
          <div className="flex items-center space-x-8">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <div className="w-4 h-4 bg-white rounded-sm"></div>
              </div>
              <span className="text-xl font-bold text-gray-900">debugify</span>
            </Link>

            <nav className="hidden md:flex items-center space-x-6">
              <Link to="/" className="text-blue-600 font-medium">
                Home
              </Link>
              <Link to="/organizations" className="text-gray-600 hover:text-gray-900">
                Organizations
              </Link>
            </nav>
          </div>

          {/* Search and User Actions */}
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input placeholder="Search" className="pl-10 w-64 bg-gray-50 border-gray-200" />
            </div>

            <Button variant="ghost" size="icon" className="text-white bg-blue-600 hover:bg-blue-700">
              <Edit className="w-4 h-4" />
            </Button>

            <Button variant="ghost" size="icon">
              <Moon className="w-4 h-4" />
            </Button>

            <div className="relative">
              <Button variant="ghost" size="icon">
                <Bell className="w-4 h-4" />
              </Button>
              <Badge className="absolute -top-1 -right-1 w-5 h-5 p-0 bg-red-500 text-white text-xs flex items-center justify-center">
                1
              </Badge>
            </div>

            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-red-100 text-red-600 text-sm font-medium">AS</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </div>
    </header>
  )
}
