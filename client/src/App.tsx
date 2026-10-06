import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Welcome from "./pages/Welcome";
import Journey from "./pages/Journey";
import Alira from "./pages/Alira";
import Assessment from "./pages/Assessment";
import FastCheck from "./pages/FastCheck";
import ExerciseRunner from "./pages/ExerciseRunner";
import MyTime from "./pages/MyTime";
import Community from "./pages/Community";
import WarmUp from "./pages/WarmUp";
import { SettingsProvider } from "./components/AccountSettings";
import { WarmRepGate } from "./components/WarmRepGate";
import { usePlanReview } from "./hooks/usePlanReview";
import "./pages/recovery-pages.css";

/** Alira's daily plan review runs in the background on every page. */
function PlanReviewRunner() {
  usePlanReview();
  return null;
}


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/welcome"} component={Welcome} />
      <Route path={"/journey"} component={Journey} />
      <Route path={"/alira"} component={Alira} />
      <Route path={"/warm-up"} component={WarmUp} />
      <Route path={"/assessment"}>{() => <WarmRepGate gate="pre_assessment"><Assessment /></WarmRepGate>}</Route>
      <Route path={"/fast-check"} component={FastCheck} />
      <Route path={"/my-time"} component={MyTime} />
      <Route path={"/community"} component={Community} />
      <Route path={"/exercise/:id"}>{() => <WarmRepGate gate="pre_exercise"><ExerciseRunner /></WarmRepGate>}</Route>
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
          <SettingsProvider><PlanReviewRunner /><Router /></SettingsProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
