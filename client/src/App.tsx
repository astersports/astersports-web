import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import AAUBasketball from "./pages/AAUBasketball";
import BillingDashboard from "./pages/admin/Billing";
import AdminLogs from "./pages/admin/Logs";

// Studio pages (lazy-ish but simple imports for now)
import StudioLayout from "./pages/studio/StudioLayout";
import StudioEditor from "./pages/studio/StudioEditor";
import StudioHistory from "./pages/studio/StudioHistoryV2";
import StudioAdmin from "./pages/studio/StudioAdmin";
import StudioBilling from "./pages/studio/StudioBilling";
import CreditLedger from "./pages/studio/CreditLedger";
import PlatformConsole from "./pages/platform/PlatformConsole";
import JoinPage from "./pages/JoinPage";

function Router() {
  return (
    <Switch>
      {/* Public pages */}
      <Route path={"/"} component={Home} />
      <Route path={"/aau"} component={AAUBasketball} />
      <Route path={"/admin/billing"} component={BillingDashboard} />
      <Route path={"/admin/logs"} component={AdminLogs} />
      <Route path="/platform" component={PlatformConsole} />
      <Route path="/join/:token" component={JoinPage} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/terms"} component={Terms} />

      {/* Studio (gated behind login + tenant membership) */}
      <Route path="/studio">
        <StudioLayout><StudioEditor /></StudioLayout>
      </Route>
      <Route path="/studio/history">
        <StudioLayout><StudioHistory /></StudioLayout>
      </Route>
      <Route path="/studio/admin">
        <StudioLayout><StudioAdmin /></StudioLayout>
      </Route>
      <Route path="/studio/billing">
        <StudioLayout><StudioBilling /></StudioLayout>
      </Route>
      <Route path="/studio/ledger">
        <StudioLayout><CreditLedger /></StudioLayout>
      </Route>

      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
