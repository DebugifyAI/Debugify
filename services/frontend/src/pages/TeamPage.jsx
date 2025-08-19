"use client"

import { useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Bug,
  BarChart3,
  Settings,
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  ArrowLeft,
  Calendar,
  Filter,
  Sparkles,
  User,
  UserCheck,
  Upload,
  X,
  FileText,
  ImageIcon,
  File,
} from "lucide-react"

const mockBugReports = [
  {
    id: "1",
    title: "Login button not responding on mobile",
    description:
      "The login button becomes unresponsive on iOS Safari when users try to tap it multiple times quickly. This seems to happen specifically on iPhone 12 and newer models. The button appears to be clickable but no action is triggered. Users have to refresh the page to make it work again.",
    severity: "high",
    status: "open",
    reporter: "John Doe",
    assignee: "Jane Smith",
    createdAt: "2024-01-15",
    updatedAt: "2024-01-16",
    aiSuggestion:
      "This appears to be a touch event handling issue on iOS Safari. The problem likely stems from rapid tap events not being properly debounced. Recommended fix: 1) Add a debounce mechanism to prevent multiple rapid clicks, 2) Use 'touchstart' and 'touchend' events instead of 'click' for better iOS compatibility, 3) Add CSS property 'touch-action: manipulation' to the button to prevent double-tap zoom interference, 4) Implement a loading state to provide visual feedback during authentication.",
    aiReviewed: true,
    attachments: [
      {
        id: "att1",
        name: "ios-safari-console.log",
        size: 15420,
        type: "text/plain",
      },
      {
        id: "att2",
        name: "login-button-screenshot.png",
        size: 245680,
        type: "image/png",
      },
    ],
  },
  {
    id: "2",
    title: "Dashboard loading performance issue",
    description:
      "Dashboard takes over 5 seconds to load with large datasets containing more than 1000 records. The loading spinner appears but the page becomes unresponsive during data fetching. This affects user experience significantly, especially for enterprise customers with large amounts of data.",
    severity: "medium",
    status: "in-progress",
    reporter: "Alice Johnson",
    assignee: "Bob Wilson",
    createdAt: "2024-01-14",
    updatedAt: "2024-01-17",
    attachments: [
      {
        id: "att3",
        name: "performance-trace.json",
        size: 89234,
        type: "application/json",
      },
      {
        id: "att4",
        name: "network-waterfall.png",
        size: 156789,
        type: "image/png",
      },
      {
        id: "att5",
        name: "database-query.log",
        size: 34567,
        type: "text/plain",
      },
    ],
  },
  {
    id: "3",
    title: "Critical data loss in user profiles",
    description:
      "User profile data is being lost during sync operations between the mobile app and web platform. This includes profile pictures, bio information, and preference settings. The issue seems to occur when users update their profiles on mobile and then access the web version.",
    severity: "critical",
    status: "resolved",
    reporter: "Mike Chen",
    assignee: "Sarah Davis",
    createdAt: "2024-01-10",
    updatedAt: "2024-01-15",
    aiSuggestion:
      "This is likely a race condition in the synchronization process. The mobile app and web platform are probably overwriting each other's data. Recommended solution: 1) Implement proper conflict resolution using timestamps or version numbers, 2) Use optimistic locking to prevent concurrent updates, 3) Add a sync queue system to handle offline changes, 4) Implement proper error handling and retry mechanisms for failed sync operations.",
    aiReviewed: true,
    attachments: [
      {
        id: "att6",
        name: "sync-error-stack-trace.txt",
        size: 12456,
        type: "text/plain",
      },
    ],
  },
]

const sidebarItems = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "bug-reports", label: "Bug Reports", icon: Bug },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "members", label: "Team Members", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
]

export default function TeamPage() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState("overview")
  const [showReportForm, setShowReportForm] = useState(false)
  const [selectedBug, setSelectedBug] = useState(null)
  const [isGeneratingAI, setIsGeneratingAI] = useState(false)
  const [bugReports, setBugReports] = useState(mockBugReports)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const handleBackToOrganizations = () => {
    navigate("/organizations")
  }

  const generateAISuggestion = async (bug) => {
    setIsGeneratingAI(true)

    // Simulate AI processing time
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Mock AI suggestion based on bug type
    let suggestion = ""
    if (bug.title.toLowerCase().includes("performance")) {
      suggestion =
        "Performance issues often stem from inefficient database queries or unoptimized frontend rendering. Recommended approach: 1) Implement pagination or virtual scrolling for large datasets, 2) Add database indexing on frequently queried fields, 3) Use React.memo() or useMemo() to prevent unnecessary re-renders, 4) Consider implementing lazy loading for non-critical components, 5) Add performance monitoring to track improvements."
    } else if (bug.title.toLowerCase().includes("mobile") || bug.title.toLowerCase().includes("ios")) {
      suggestion =
        "Mobile-specific issues require careful attention to touch events and device compatibility. Suggested fixes: 1) Test across different iOS versions and devices, 2) Implement proper touch event handling with preventDefault(), 3) Add CSS touch-action properties for better control, 4) Use feature detection instead of user agent sniffing, 5) Consider using a mobile-first responsive design approach."
    } else if (bug.severity === "critical") {
      suggestion =
        "Critical bugs require immediate attention and thorough testing. Recommended process: 1) Implement comprehensive error logging and monitoring, 2) Add automated tests to prevent regression, 3) Use feature flags to quickly disable problematic features, 4) Implement proper backup and rollback procedures, 5) Add real-time alerting for similar issues in the future."
    } else {
      suggestion =
        "Based on the bug description, this appears to be a common issue that can be resolved with proper error handling and user experience improvements. Suggested approach: 1) Add comprehensive error logging to identify the root cause, 2) Implement proper validation and sanitization, 3) Add user-friendly error messages and recovery options, 4) Consider adding automated tests to prevent similar issues, 5) Review related code for potential improvements."
    }

    // Update the bug with AI suggestion
    const updatedBugReports = bugReports.map((report) =>
      report.id === bug.id ? { ...report, aiSuggestion: suggestion, aiReviewed: true } : report,
    )
    setBugReports(updatedBugReports)

    // Update selected bug if it's the same one
    if (selectedBug?.id === bug.id) {
      setSelectedBug({ ...bug, aiSuggestion: suggestion, aiReviewed: true })
    }

    setIsGeneratingAI(false)
  }

  const handleFileUpload = (files) => {
    setIsUploading(true)

    Array.from(files).forEach((file) => {
      // Simulate upload process
      setTimeout(() => {
        const newFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          size: file.size,
          type: file.type,
          url: URL.createObjectURL(file),
        }
        setUploadedFiles((prev) => [...prev, newFile])
        setIsUploading(false)
      }, 1000)
    })
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files)
    }
  }

  const removeFile = (fileId) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== fileId))
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const getFileIcon = (type) => {
    if (type.startsWith("image/")) return <ImageIcon className="w-4 h-4" />
    if (type.includes("text") || type.includes("log")) return <FileText className="w-4 h-4" />
    return <File className="w-4 h-4" />
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-800"
      case "high":
        return "bg-orange-100 text-orange-800"
      case "medium":
        return "bg-yellow-100 text-yellow-800"
      case "low":
        return "bg-green-100 text-green-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case "open":
        return "bg-blue-100 text-blue-800"
      case "in-progress":
        return "bg-purple-100 text-purple-800"
      case "resolved":
        return "bg-green-100 text-green-800"
      case "closed":
        return "bg-gray-100 text-gray-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const renderContent = () => {
    switch (activeSection) {
      case "overview":
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Reports</p>
                      <p className="text-2xl font-bold">24</p>
                    </div>
                    <Bug className="w-8 h-8 text-blue-600" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Open Issues</p>
                      <p className="text-2xl font-bold text-red-600">8</p>
                    </div>
                    <AlertTriangle className="w-8 h-8 text-red-600" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">In Progress</p>
                      <p className="text-2xl font-bold text-yellow-600">5</p>
                    </div>
                    <Clock className="w-8 h-8 text-yellow-600" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Resolved</p>
                      <p className="text-2xl font-bold text-green-600">11</p>
                    </div>
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Bug Reports</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {bugReports.slice(0, 3).map((report) => (
                    <div
                      key={report.id}
                      onClick={() => setSelectedBug(report)}
                      className="flex items-center justify-between p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{report.title}</h4>
                        <p className="text-sm text-gray-500 mt-1">{report.description.slice(0, 80)}...</p>
                        <div className="flex items-center space-x-2 mt-2">
                          <Badge className={getSeverityColor(report.severity)}>{report.severity}</Badge>
                          <Badge className={getStatusColor(report.status)}>{report.status}</Badge>
                          {report.aiReviewed && (
                            <Badge className="bg-purple-100 text-purple-800">
                              <Sparkles className="w-3 h-3 mr-1" />
                              AI Reviewed
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        <p>Reporter: {report.reporter}</p>
                        <p>{report.createdAt}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )

      case "bug-reports":
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Bug Reports</h2>
              <div className="flex items-center space-x-3">
                <Button variant="outline" size="sm">
                  <Filter className="w-4 h-4 mr-2" />
                  Filter
                </Button>
                <Button onClick={() => setShowReportForm(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Report Bug
                </Button>
              </div>
            </div>

            {showReportForm && (
              <Card>
                <CardHeader>
                  <CardTitle>Submit Bug Report</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                    <Input placeholder="Brief description of the bug" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <Textarea
                      placeholder="Detailed description of the bug, steps to reproduce, expected vs actual behavior..."
                      rows={4}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Severity</label>
                      <select className="w-full p-2 border border-gray-300 rounded-md">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Assignee</label>
                      <select className="w-full p-2 border border-gray-300 rounded-md">
                        <option value="">Select assignee</option>
                        <option value="jane">Jane Smith</option>
                        <option value="bob">Bob Wilson</option>
                        <option value="sarah">Sarah Davis</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Attachments
                      <span className="text-gray-500 font-normal ml-1">(Log files, screenshots, stack traces)</span>
                    </label>

                    <div
                      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                        isDragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
                      }`}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      {isUploading ? (
                        <div className="space-y-2">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                          <p className="text-sm text-gray-600">Uploading files...</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Upload className="w-8 h-8 text-gray-400 mx-auto" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">Upload bug artifacts</p>
                            <p className="text-xs text-gray-500 mt-1">
                              Drag and drop files here, or{" "}
                              <label className="text-blue-600 hover:text-blue-700 cursor-pointer">
                                browse
                                <input
                                  type="file"
                                  multiple
                                  className="hidden"
                                  accept=".log,.txt,.png,.jpg,.jpeg,.gif,.pdf,.json,.xml"
                                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                                />
                              </label>
                            </p>
                          </div>
                          <p className="text-xs text-gray-400">
                            Supports: Images, log files, text files, PDFs (Max 10MB each)
                          </p>
                        </div>
                      )}
                    </div>

                    {uploadedFiles.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm font-medium text-gray-700">Uploaded Files ({uploadedFiles.length})</p>
                        <div className="space-y-2">
                          {uploadedFiles.map((file) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg"
                            >
                              <div className="flex items-center space-x-3">
                                <div className="text-gray-500">{getFileIcon(file.type)}</div>
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                                  <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeFile(file.id)}
                                className="text-gray-400 hover:text-red-600"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {uploadedFiles.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm text-blue-800">
                          ✓ {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""} ready to attach. These
                          will be included with your bug report.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-3">
                    <Button>Submit Report</Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowReportForm(false)
                        setUploadedFiles([])
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              {bugReports.map((report) => (
                <Card key={report.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-6" onClick={() => setSelectedBug(report)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg text-gray-900">{report.title}</h3>
                        <p className="text-gray-600 mt-2">{report.description}</p>
                        <div className="flex items-center space-x-4 mt-4">
                          <Badge className={getSeverityColor(report.severity)}>{report.severity}</Badge>
                          <Badge className={getStatusColor(report.status)}>{report.status}</Badge>
                          {report.aiReviewed && (
                            <Badge className="bg-purple-100 text-purple-800">
                              <Sparkles className="w-3 h-3 mr-1" />
                              AI Reviewed
                            </Badge>
                          )}
                          <span className="text-sm text-gray-500">Reporter: {report.reporter}</span>
                          {report.assignee && (
                            <span className="text-sm text-gray-500">Assignee: {report.assignee}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        <p className="flex items-center">
                          <Calendar className="w-4 h-4 mr-1" />
                          {report.createdAt}
                        </p>
                        <p className="mt-1">Updated: {report.updatedAt}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )

      case "analytics":
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Analytics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Bug Reports by Severity</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Critical</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div className="bg-red-600 h-2 rounded-full" style={{ width: "15%" }}></div>
                        </div>
                        <span className="text-sm font-medium">2</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">High</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div className="bg-orange-600 h-2 rounded-full" style={{ width: "35%" }}></div>
                        </div>
                        <span className="text-sm font-medium">5</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Medium</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div className="bg-yellow-600 h-2 rounded-full" style={{ width: "50%" }}></div>
                        </div>
                        <span className="text-sm font-medium">8</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Low</span>
                      <div className="flex items-center space-x-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div className="bg-green-600 h-2 rounded-full" style={{ width: "60%" }}></div>
                        </div>
                        <span className="text-sm font-medium">9</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Resolution Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-blue-600">2.4</p>
                      <p className="text-sm text-gray-500">Average days to resolve</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Critical: 0.5 days</span>
                        <span>High: 1.2 days</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Medium: 2.8 days</span>
                        <span>Low: 4.1 days</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )

      default:
        return <div>Content for {activeSection}</div>
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      {/* Team Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" onClick={handleBackToOrganizations}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Organizations
              </Button>
              <div className="flex items-center space-x-3">
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-blue-100 text-blue-600 font-semibold">FD</AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-xl font-semibold">Frontend Development</h1>
                  <p className="text-sm text-gray-500">TechCorp Inc.</p>
                </div>
                <Badge className="bg-green-100 text-green-800">Active</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <div className="w-64 flex-shrink-0">
            <Card>
              <CardContent className="p-0">
                <nav className="space-y-1">
                  {sidebarItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-none first:rounded-t-lg last:rounded-b-lg transition-colors ${
                          activeSection === item.id
                            ? "bg-blue-50 text-blue-700 border-r-2 border-blue-700"
                            : "text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <Icon className="w-5 h-5 mr-3" />
                        {item.label}
                      </button>
                    )
                  })}
                </nav>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="flex-1">{renderContent()}</div>
        </div>
      </div>

      <Dialog open={!!selectedBug} onOpenChange={() => setSelectedBug(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">Bug Details</DialogTitle>
          </DialogHeader>

          {selectedBug && (
            <div className="space-y-6">
              {/* Bug Details */}
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg mb-2">Description</h3>
                  <p className="text-gray-700 leading-relaxed">{selectedBug.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <User className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Reporter:</span>
                      <span className="font-medium">{selectedBug.reporter}</span>
                    </div>
                    {selectedBug.assignee && (
                      <div className="flex items-center space-x-2">
                        <UserCheck className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-600">Assignee:</span>
                        <span className="font-medium">{selectedBug.assignee}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Created:</span>
                      <span className="font-medium">{selectedBug.createdAt}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Updated:</span>
                      <span className="font-medium">{selectedBug.updatedAt}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Attachments Section */}
              {selectedBug.attachments && selectedBug.attachments.length > 0 && (
                <div className="border-t pt-6">
                  <h3 className="font-semibold text-lg mb-4 flex items-center">
                    <Upload className="w-5 h-5 mr-2 text-gray-600" />
                    Attachments ({selectedBug.attachments.length})
                  </h3>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-blue-800 flex items-center">
                      <Sparkles className="w-4 h-4 mr-2" />
                      These files will be analyzed by AI to provide more accurate technical recommendations.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedBug.attachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center space-x-3 p-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <div className="text-gray-500 flex-shrink-0">{getFileIcon(file.type)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                        </div>
                        <div className="flex-shrink-0">
                          <Badge variant="outline" className="text-xs">
                            {file.type.split("/")[0]}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Suggestion Section */}
              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg flex items-center">
                    <Sparkles className="w-5 h-5 mr-2 text-purple-600" />
                    AI Suggestion
                  </h3>
                  {!selectedBug.aiSuggestion && (
                    <Button
                      onClick={() => generateAISuggestion(selectedBug)}
                      disabled={isGeneratingAI}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {isGeneratingAI ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Suggest Fix
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {selectedBug.aiSuggestion ? (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                    <p className="text-gray-800 leading-relaxed whitespace-pre-line">{selectedBug.aiSuggestion}</p>
                  </div>
                ) : (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                    <Sparkles className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">No AI suggestion generated yet.</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Click "Suggest Fix" to get AI-powered recommendations
                      {selectedBug.attachments && selectedBug.attachments.length > 0 && " based on your uploaded files"}
                      .
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  )
}
