"use client"

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Users, Settings, ChevronDown, ChevronUp } from "lucide-react"

const mockTeams = [
  {
    id: "1",
    name: "Frontend Development",
    organization: "TechCorp Inc.",
    role: "Developer",
    members: 12,
    status: "active",
    lastActivity: "2 hours ago",
  },
  {
    id: "2",
    name: "QA Testing",
    organization: "TechCorp Inc.",
    role: "Lead Tester",
    members: 8,
    status: "active",
    lastActivity: "1 day ago",
  },
  {
    id: "3",
    name: "Backend Services",
    organization: "StartupXYZ",
    role: "Senior Developer",
    members: 15,
    status: "active",
    lastActivity: "3 hours ago",
  },
  {
    id: "4",
    name: "Mobile Team",
    organization: "StartupXYZ",
    role: "Developer",
    members: 6,
    status: "pending",
    lastActivity: "1 week ago",
  },
]

export default function OrganizationsPage() {
  const [expandedOrgs, setExpandedOrgs] = useState(["TechCorp Inc."])
  const navigate = useNavigate()

  const groupedTeams = mockTeams.reduce((acc, team) => {
    if (!acc[team.organization]) {
      acc[team.organization] = []
    }
    acc[team.organization].push(team)
    return acc
  }, {})

  const toggleOrganization = (orgName) => {
    setExpandedOrgs((prev) => (prev.includes(orgName) ? prev.filter((name) => name !== orgName) : [...prev, orgName]))
  }

  const handleTeamClick = (teamId) => {
    navigate(`/teams/${teamId}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Organizations</h1>
          <p className="text-gray-600">Manage your teams and organization memberships</p>
        </div>

        <div className="space-y-6">
          {Object.entries(groupedTeams).map(([orgName, teams]) => (
            <Card key={orgName} className="border border-gray-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Avatar className="w-10 h-10">
                      <AvatarFallback className="bg-blue-100 text-blue-600 font-semibold">
                        {orgName
                          .split(" ")
                          .map((word) => word[0])
                          .join("")
                          .slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-lg">{orgName}</CardTitle>
                      <p className="text-sm text-gray-500">{teams.length} teams</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm">
                      <Settings className="w-4 h-4 mr-2" />
                      Settings
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleOrganization(orgName)}>
                      {expandedOrgs.includes(orgName) ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expandedOrgs.includes(orgName) && (
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {teams.map((team) => (
                      <div
                        key={team.id}
                        className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:bg-gray-100 hover:border-gray-200 transition-colors"
                        onClick={() => handleTeamClick(team.id)}
                      >
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 bg-white rounded-lg border border-gray-200 flex items-center justify-center">
                            <Users className="w-5 h-5 text-gray-600" />
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900">{team.name}</h3>
                            <div className="flex items-center space-x-4 text-sm text-gray-500">
                              <span>{team.members} members</span>
                              <span>•</span>
                              <span>Last activity {team.lastActivity}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-3">
                          <Badge
                            variant={team.status === "active" ? "default" : "secondary"}
                            className={team.status === "active" ? "bg-green-100 text-green-800" : ""}
                          >
                            {team.role}
                          </Badge>
                          <Badge
                            variant={team.status === "active" ? "default" : "outline"}
                            className={team.status === "active" ? "bg-blue-100 text-blue-800" : ""}
                          >
                            {team.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {Object.keys(groupedTeams).length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No organizations yet</h3>
              <p className="text-gray-500 mb-4">Join an organization to start collaborating with teams</p>
              <Button>Join Organization</Button>
            </CardContent>
          </Card>
        )}
      </main>

      <Footer />
    </div>
  )
}
