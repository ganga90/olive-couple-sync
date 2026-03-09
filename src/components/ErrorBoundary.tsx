import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Global Error Boundary
 * Catches unhandled errors and displays a graceful fallback UI
 * Prevents white screen crashes
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });

    // Log to analytics or error tracking service
    if (window.location.hostname !== 'localhost') {
      // TODO: Send to error tracking service (e.g., Sentry)
      console.error('Production error:', { error, errorInfo });
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    window.location.href = '/';
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-soft flex items-center justify-center p-4">
          <Card className="max-w-2xl w-full p-8 md:p-12 bg-card shadow-2xl border border-border/50">
            <div className="flex flex-col items-center text-center space-y-6">
              {/* Error Icon */}
              <div className="h-20 w-20 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-10 w-10 text-destructive" />
              </div>

              {/* Error Title */}
              <div className="space-y-2">
                <h1 className="text-3xl md:text-4xl font-bold text-foreground font-serif">
                  Oops! Something went wrong
                </h1>
                <p className="text-muted-foreground text-base md:text-lg max-w-md mx-auto">
                  We encountered an unexpected error. Don't worry, your data is safe.
                </p>
              </div>

              {/* Error Details (only in development) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="w-full">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
                    View error details
                  </summary>
                  <pre className="text-left text-xs bg-muted/50 p-4 rounded-lg overflow-auto max-h-48 border border-border">
                    <code>
                      {this.state.error.toString()}
                      {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </code>
                  </pre>
                </details>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                <Button
                  onClick={this.handleReset}
                  className="flex-1 h-12 text-base font-semibold"
                  variant="default"
                >
                  <RefreshCw className="mr-2 h-5 w-5" />
                  Go to Home
                </Button>
                <Button
                  onClick={this.handleReload}
                  className="flex-1 h-12 text-base font-semibold"
                  variant="outline"
                >
                  Reload Page
                </Button>
              </div>

              {/* Help Text */}
              <p className="text-sm text-muted-foreground">
                If this problem persists, please{' '}
                <a
                  href="mailto:support@olive.app"
                  className="text-primary hover:underline font-medium"
                >
                  contact support
                </a>
              </p>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
