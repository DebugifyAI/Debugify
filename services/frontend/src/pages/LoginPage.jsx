"use client"

import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { ArrowLeft, ArrowRight, Github, Apple, Linkedin, Facebook, Lock } from "lucide-react"

export default function LoginPage() {
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [email, setEmail] = useState("")
  const navigate = useNavigate()

  const handleEmailSubmit = (e) => {
    e.preventDefault()
    // Mock login - redirect to dashboard
    navigate("/")
  }

  const handleSocialLogin = (provider) => {
    // Mock social login - redirect to dashboard
    console.log(`[v0] Logging in with ${provider}`)
    navigate("/")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-400 via-purple-500 to-blue-500 flex items-center justify-center p-6">
      {/* Go back button - positioned absolutely */}
      <Link
        to="/"
        className="absolute top-6 right-6 flex items-center gap-2 text-white/80 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Go back
      </Link>

      {/* Centered login card */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-12 justify-center">
          <div className="w-8 h-8 bg-blue-600 rounded transform rotate-45"></div>
          <span className="text-xl font-semibold">debugify</span>
        </div>

        {!showEmailForm ? (
          <>
            {/* Login options */}
            <div className="space-y-6">
              <h1 className="text-2xl font-semibold text-gray-900 mb-8 text-center">Log in or sign up</h1>

              {/* Google login */}
              <Button
                onClick={() => handleSocialLogin("Google")}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-base font-medium"
              >
                <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </Button>

              {/* SSO login */}
              <Button
                onClick={() => handleSocialLogin("SSO")}
                variant="outline"
                className="w-full py-3 text-base font-medium border-gray-300"
              >
                <Lock className="w-5 h-5 mr-3" />
                Continue with SSO
              </Button>

              {/* Divider */}
              <div className="flex items-center gap-4 my-6">
                <div className="flex-1 h-px bg-gray-300"></div>
                <span className="text-gray-500 text-sm">or</span>
                <div className="flex-1 h-px bg-gray-300"></div>
              </div>

              {/* Social icons */}
              <div className="flex justify-center gap-6 mb-8">
                <button
                  onClick={() => handleSocialLogin("GitHub")}
                  className="p-3 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <Github className="w-6 h-6 text-gray-700" />
                </button>
                <button
                  onClick={() => handleSocialLogin("Apple")}
                  className="p-3 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <Apple className="w-6 h-6 text-gray-700" />
                </button>
                <button
                  onClick={() => handleSocialLogin("LinkedIn")}
                  className="p-3 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <Linkedin className="w-6 h-6 text-gray-700" />
                </button>
                <button
                  onClick={() => handleSocialLogin("Facebook")}
                  className="p-3 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  <Facebook className="w-6 h-6 text-gray-700" />
                </button>
              </div>

              {/* Email option */}
              <div className="text-center">
                <button
                  onClick={() => setShowEmailForm(true)}
                  className="flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors mx-auto"
                >
                  Continue with email address
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Email form */}
            <div className="space-y-6">
              <h1 className="text-2xl font-semibold text-gray-900 mb-8 text-center">Sign in with email</h1>

              <form onSubmit={handleEmailSubmit} className="space-y-6">
                <Input
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full py-3 text-base"
                  required
                />

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-base font-medium"
                >
                  Continue
                </Button>
              </form>

              <div className="text-center">
                <button
                  onClick={() => setShowEmailForm(false)}
                  className="flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors mx-auto"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to login options
                </button>
              </div>
            </div>
          </>
        )}

        {/* Terms */}
        <p className="text-sm text-gray-500 text-center mt-8">
          By logging in or signing up using the options above, you agree to{" "}
          <Link to="/terms" className="text-blue-600 hover:underline">
            Debugify's Terms & Conditions
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="text-blue-600 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  )
}
