import React from 'react';
import './ErrorBoundary.css';

// Declare window augmentation for OTel tracer
declare global {
  interface Window {
    __OTEL_TRACER__?: any;
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      reportedToBackend: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const errorId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.setState({ errorInfo, errorId });

    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }

    // Report error to backend
    this.reportErrorToBackend(error, errorInfo, errorId);
  }

  reportErrorToBackend = async (error, errorInfo, errorId) => {
    try {
      const errorReport = {
        id: errorId,
        message: error.toString(),
        stack: error.stack || '',
        componentStack: errorInfo.componentStack || '',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      };

      // Send error report to backend
      const response = await fetch('/api/errors/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(errorReport),
      }).catch(() => {
        // Silently handle network errors for error reporting
        console.warn('Failed to report error to backend');
      });

      if (response && response.ok) {
        this.setState({ reportedToBackend: true });
      }
    } catch (reportingError) {
      // Silently handle any error reporting failures
      console.warn('Error reporting failed:', reportingError);
    }
  };

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      reportedToBackend: false,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleReportError = () => {
    const errorDetails = {
      id: this.state.errorId,
      message: this.state.error?.toString(),
      stack: this.state.error?.stack,
      componentStack: this.state.errorInfo?.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    const text = JSON.stringify(errorDetails, null, 2);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        alert('Error details copied to clipboard! Please share with support.');
      }).catch(() => {
        prompt('Copy error details:', text);
      });
    } else {
      prompt('Copy error details:', text);
    }

    // Capture error in OTel trace if available
    if (window.__OTEL_TRACER__) {
      try {
        const span = window.__OTEL_TRACER__.startSpan('error_report');
        span.addEvent('error_reported', {
          'error.id': this.state.errorId,
          'error.message': this.state.error?.toString(),
        });
        span.end();
      } catch (e) {
        console.warn('Failed to capture OTel trace');
      }
    }
  };

  render() {
    if (this.state.hasError) {
      const isDevelopment = process.env.NODE_ENV === 'development';

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
              <button
                className="error-boundary-btn error-boundary-btn-tertiary"
                onClick={this.handleReportError}
                aria-label="Copy error details to clipboard for reporting"
              >
                📋 Report Error
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
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;