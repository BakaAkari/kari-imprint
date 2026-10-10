import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  onReset?: () => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] render failure', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.handleReset);
    return (
      <div className="error-boundary-fallback" role="alert">
        <div className="error-boundary-fallback__title">预览渲染失败</div>
        <div className="error-boundary-fallback__hint">
          请尝试删除全部图片重新上传，或刷新页面。
        </div>
        <div className="error-boundary-fallback__actions">
          <button type="button" onClick={this.handleReset}>
            重置画布
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
