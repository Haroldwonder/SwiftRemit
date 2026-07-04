import React, { ReactNode } from 'react'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  errorId: string | null
  reportedToBackend: boolean
}

interface ErrorReport {
  id: string
  message: string
  stack: string
  componentStack: string
  timestamp: string
  userAgent: string
  url: string
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      reportedToBackend: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const errorId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    this.setState({ errorInfo, errorId })

    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo)
    }

    this.reportErrorToBackend(error, errorInfo, errorId)
  }

  reportErrorToBackend = async (error: Error, errorInfo: React.ErrorInfo, errorId: string): Promise<void> => {
    try {
      const errorReport: ErrorReport = {
        id: errorId,
        message: error.toString(),
        stack: error.stack || '',
        componentStack: errorInfo.componentStack || '',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      }

      const response = await fetch('/api/errors/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(errorReport),
      }).catch(() => {
        console.warn('Failed to report error to backend')
      })

      if (response && response.ok) {
        this.setState({ reportedToBackend: true })
      }
    } catch (reportingError) {
      console.warn('Error reporting failed:', reportingError)
    }
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      reportedToBackend: false,
    })
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const isDevelopment = process.env.NODE_ENV === 'development'

      return (
        <div
          className="error-boundary-container"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <div className="error-boundary-content">
            <div className="error-boundary-icon">⚠️</div>
            <h1 className="error-boundary-title">Something Went Wrong</h1>
            <p className="error-boundary-message">
              We encountered an unexpected error. Please try again or reload the page to continue.
              {this.state.errorId && (
                <>
                  <br />
                  <small style={{ opacity: 0.7 }}>Error ID: {this.state.errorId}</small>
                </>
              )}
            </p>

            <div className="error-boundary-actions">
              <button
                className="error-boundary-btn error-boundary-btn-primary"
                onClick={this.handleRetry}
                aria-label="Retry the failed operation"
              >
                🔄 Try Again
              </button>
              <button
                className="error-boundary-btn error-boundary-btn-secondary"
                onClick={this.handleReload}
                aria-label="Reload the page"
              >
                🔃 Reload Page
              </button>
            </div>

            {isDevelopment && this.state.error && (
              <details className="error-boundary-details">
                <summary>📋 Error Details (Dev Only)</summary>
                <div>
                  <strong>Error Message:</strong>
                  <pre>{this.state.error.toString()}</pre>
                </div>
                {this.state.errorInfo && (
                  <div>
                    <strong>Component Stack:</strong>
                    <pre>{this.state.errorInfo.componentStack}</pre>
                  </div>
                )}
                {this.state.errorId && (
                  <div>
                    <strong>Error ID:</strong>
                    <pre>{this.state.errorId}</pre>
                  </div>
                )}
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
