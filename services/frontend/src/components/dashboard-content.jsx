"use client"

import { useState } from "react"
import { Bug, Edit, BarChart3, ExternalLink, ChevronDown, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function DashboardContent() {
  const [reportsExpanded, setReportsExpanded] = useState(true)
  const [hasReports, setHasReports] = useState(true)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero Section */}
      <div className="mb-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Track and manage your bug reports</h1>

        <div className="flex gap-4">
          <Card className="flex-1 max-w-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center">
                  <Bug className="w-5 h-5 text-red-600" />
                </div>
                <span className="font-medium text-gray-900">Report Bug</span>
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1 max-w-sm cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-orange-600" />
                </div>
                <span className="font-medium text-gray-900">View Analytics</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-1">Your Bug Reports</h2>
            <p className="text-gray-600">Track and manage all your submitted bug reports.</p>
          </div>
          <Button
            variant="ghost"
            onClick={() => setReportsExpanded(!reportsExpanded)}
            className="text-gray-500 hover:text-gray-700"
          >
            {reportsExpanded ? "Collapse section" : "Expand section"}
            <ChevronDown className={`w-4 h-4 ml-1 transition-transform ${reportsExpanded ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {reportsExpanded && (
          <div className="space-y-4">
            {hasReports ? (
              <>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h3 className="font-semibold text-gray-900">Login Form Validation Error</h3>
                          <Badge variant="destructive">Critical</Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">debugify.app/login</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span className="flex items-center">
                            <Clock className="w-4 h-4 mr-1" />
                            Reported 2 days ago
                          </span>
                          <span>Status: In Progress</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center space-x-4">
                        <Button variant="ghost" size="sm" className="text-gray-600">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Report
                        </Button>
                        <Button variant="ghost" size="sm" className="text-gray-600">
                          <BarChart3 className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                      </div>
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <h3 className="font-semibold text-gray-900">Dashboard Loading Issue</h3>
                          <Badge variant="secondary">Medium</Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">debugify.app/dashboard</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span className="flex items-center">
                            <Clock className="w-4 h-4 mr-1" />
                            Reported 5 days ago
                          </span>
                          <span>Status: Resolved</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                      <div className="flex items-center space-x-4">
                        <Button variant="ghost" size="sm" className="text-gray-600">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Report
                        </Button>
                        <Button variant="ghost" size="sm" className="text-gray-600">
                          <BarChart3 className="w-4 h-4 mr-2" />
                          View Details
                        </Button>
                      </div>
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <Bug className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-600 mb-2">No bug reports submitted yet.</p>
                <p className="text-gray-600">Start by reporting your first bug.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toggle button for demo */}
      <div className="mt-8 text-center">
        <Button onClick={() => setHasReports(!hasReports)} variant="outline" className="text-sm">
          Toggle reports state (demo)
        </Button>
      </div>
    </div>
  )
}
