import { Component } from "react";
import ServerErrorPage from "@/pages/ServerErrorPage";

// A screen that throws while rendering shows the 500 page ("crash") instead of a blank page.
// resetKey (the path): moving to another page clears the error; "Try again" clears it too.
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("[app] a screen crashed:", error, info?.componentStack);
  }

  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (this.state.failed) return <ServerErrorPage reason="crash" onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}
