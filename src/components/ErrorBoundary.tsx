// Route-level error boundary. The app has no other boundary, so before this an
// uncaught render throw in ANY page (a malformed RSS link, a task with no title,
// a backend payload missing a nested array…) unmounted the whole React tree and
// blanked the entire dashboard — sidebar, topbar and every other route included.
// Wrapping the routed <Outlet/> with this contains a crash to the content pane:
// the operator keeps the nav and can switch to a working module. Layout keys it
// on the pathname, so navigating to another route remounts it with fresh state.
//
// Must be a class component — getDerivedStateFromError / componentDidCatch have
// no hook equivalent. The fallback is intentionally dependency-free (plain divs)
// so it cannot itself throw while reporting a crash.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the crash in the console for debugging — the boundary swallows it
    // from the UI, so without this the stack would be lost.
    console.error('[ErrorBoundary] render crash contained:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-full w-full flex items-center justify-center p-6 overflow-auto">
        <div className="max-w-[560px] w-full border border-red-400/40 bg-[#0a0506]/90 p-5 font-mono">
          <div className="flex items-center gap-2 text-red-400 text-[12px] tracking-[0.2em] uppercase mb-3">
            <span className="text-[14px]">⚠</span> Module render fault
          </div>
          <div className="text-[#b8b8b8] text-[11px] leading-relaxed mb-3">
            This panel hit an unexpected error and was isolated so the rest of
            Mission Control keeps running. The other modules in the sidebar are
            unaffected — switch to one of them, or retry below.
          </div>
          <pre className="text-red-400/80 text-[10px] whitespace-pre-wrap break-all bg-[#050505] border border-white/[0.06] p-2 mb-3 max-h-[160px] overflow-auto">
            {error.message || String(error)}
          </pre>
          <button
            onClick={this.reset}
            className="text-[10px] tracking-widest uppercase border border-[#f64e6e]/40 bg-[#f64e6e]/10 text-[#f64e6e] px-3 py-1.5 hover:bg-[#f64e6e]/20 transition-colors"
          >
            ▷ Retry render
          </button>
        </div>
      </div>
    );
  }
}
