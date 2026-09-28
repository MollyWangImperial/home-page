import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Journey from "./pages/Journey";
import Alira from "./pages/Alira";
import MyTime from "./pages/MyTime";
import { SettingsProvider } from "./components/AccountSettings";
import "./pages/recovery-pages.css";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/journey"} component={Journey} />
      <Route path={"/alira"} component={Alira} />
      <Route path={"/my-time"} component={MyTime} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <SettingsProvider><Router /></SettingsProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
