import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

// Eager imports — critical-path routes that should be in the initial
// bundle so first paint is instant. Everything else is React.lazy()
// below; the heavy pages (NoteDetails, Profile, Admin, Knowledge,
// AgentDetail, Expenses, MyDay, Onboarding) each get their own chunk
// so users only pay for the page they're on.
import Root from "./pages/Root";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import AuthPage from "./pages/Auth";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";
import AuthRedirectNative from "./pages/AuthRedirectNative";
import NativeWelcome from "./pages/NativeWelcome";

// Lazy-loaded routes — see TASK-10X-Phase2 in OLIVE_10X_PLAN.md.
// Each of these becomes its own JS chunk in the build output.
const Lists = lazy(() => import("./pages/Lists"));
const ListCategory = lazy(() => import("./pages/ListCategory"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Profile = lazy(() => import("./pages/Profile"));
const NoteDetails = lazy(() => import("./pages/NoteDetails"));
const Welcome = lazy(() => import("./pages/Welcome"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const Reminders = lazy(() => import("./pages/Reminders"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const JoinInvite = lazy(() => import("./pages/JoinInvite"));
const GoogleCalendarCallback = lazy(() => import("./pages/GoogleCalendarCallback"));
const OuraCallback = lazy(() => import("./pages/OuraCallback"));
const MyDay = lazy(() => import("./pages/MyDay"));
const TermsOfService = lazy(() => import("./pages/legal/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/legal/PrivacyPolicy"));
const ExpensesPage = lazy(() => import("./pages/Expenses"));
const RequestAccessPage = lazy(() => import("./pages/RequestAccess"));
const AdminPage = lazy(() => import("./pages/Admin"));
const AgentDetail = lazy(() => import("./pages/AgentDetail"));
const Knowledge = lazy(() => import("./pages/Knowledge"));

import { AppLayout } from "./components/layout/AppLayout";
import { AuthProvider } from "./providers/AuthProvider";
import { SupabaseCoupleProvider } from "./providers/SupabaseCoupleProvider";
import { SupabaseNotesProvider } from "./providers/SupabaseNotesProvider";
import { LanguageProvider } from "./providers/LanguageProvider";
import { SpaceProvider } from "./providers/SpaceProvider";
import CookieConsentBanner from "./components/CookieConsentBanner";
// FeedbackDialog was mounted here as a floating action button. Removed
// because it was stacking with FloatingSpeedDial + FloatingActionButton
// (three overlapping bottom-right FABs per user report). Feedback is now
// accessible via Settings → Help & Support ("Send Feedback" card).
import ErrorBoundary from "./components/ErrorBoundary";
import { RouteSuspenseFallback } from "./components/RouteSuspenseFallback";

// Import i18n configuration
import './lib/i18n/config';

const queryClient = new QueryClient();

// Define all app routes to be used with optional locale prefix.
// Suspense wraps every route so the lazy() ones get a fallback during
// chunk fetch; eager routes pass through instantly (zero overhead).
const AppRoutes = () => (
  <Suspense fallback={<RouteSuspenseFallback />}>
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="/home" element={<Home />} />
      <Route path="/myday" element={<MyDay />} />
      <Route path="/lists" element={<Lists />} />
      <Route path="/lists/:listId" element={<ListCategory />} />
      <Route path="/calendar" element={<CalendarPage />} />
      <Route path="/reminders" element={<Reminders />} />
      <Route path="/expenses" element={<ExpensesPage />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/knowledge" element={<Knowledge />} />
      <Route path="/agents/:agentId" element={<AgentDetail />} />
      <Route path="/notes/:id" element={<NoteDetails />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/request-access" element={<RequestAccessPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/auth-redirect-native" element={<AuthRedirectNative />} />
      <Route path="/native-welcome" element={<NativeWelcome />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/join/:token" element={<JoinInvite />} />
      <Route path="/auth/google/callback" element={<GoogleCalendarCallback />} />
      <Route path="/auth/oura/callback" element={<OuraCallback />} />
      <Route path="/legal/terms" element={<TermsOfService />} />
      <Route path="/legal/privacy" element={<PrivacyPolicy />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Suspense>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <SupabaseCoupleProvider>
          <SpaceProvider>
          <SupabaseNotesProvider>
            <BrowserRouter>
              <LanguageProvider>
                <AppLayout>
                  <Routes>
                    {/* Spanish (Spain) routes */}
                    <Route path="/es-es/*" element={<AppRoutes />} />
                    {/* Italian routes */}
                    <Route path="/it-it/*" element={<AppRoutes />} />
                    {/* English (default) routes - all handled by AppRoutes */}
                    <Route path="*" element={<AppRoutes />} />
                  </Routes>
                  <CookieConsentBanner />
                </AppLayout>
              </LanguageProvider>
            </BrowserRouter>
          </SupabaseNotesProvider>
          </SpaceProvider>
        </SupabaseCoupleProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
