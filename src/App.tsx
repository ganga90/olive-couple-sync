import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Root from "./pages/Root";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import Lists from "./pages/Lists";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import NoteDetails from "./pages/NoteDetails";
import Welcome from "./pages/Welcome";
import ListCategory from "./pages/ListCategory";
import CalendarPage from "./pages/CalendarPage";
import Reminders from "./pages/Reminders";
import AcceptInvite from "./pages/AcceptInvite";
import JoinInvite from "./pages/JoinInvite";
import GoogleCalendarCallback from "./pages/GoogleCalendarCallback";
import TermsOfService from "./pages/legal/TermsOfService";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthProvider } from "./providers/AuthProvider";
import { SupabaseCoupleProvider } from "./providers/SupabaseCoupleProvider";
import { SupabaseNotesProvider } from "./providers/SupabaseNotesProvider";
import { LanguageProvider } from "./providers/LanguageProvider";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";
import AuthRedirectNative from "./pages/AuthRedirectNative";
import CookieConsentBanner from "./components/CookieConsentBanner";

// Import i18n configuration
import './lib/i18n/config';

const queryClient = new QueryClient();

// Define all app routes to be used with optional locale prefix
const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Root />} />
    <Route path="/landing" element={<Landing />} />
    <Route path="/home" element={<Home />} />
    <Route path="/lists" element={<Lists />} />
    <Route path="/lists/:listId" element={<ListCategory />} />
    <Route path="/calendar" element={<CalendarPage />} />
    <Route path="/reminders" element={<Reminders />} />
    <Route path="/onboarding" element={<Onboarding />} />
    <Route path="/welcome" element={<Welcome />} />
    <Route path="/profile" element={<Profile />} />
    <Route path="/notes/:id" element={<NoteDetails />} />
    <Route path="/sign-in" element={<SignInPage />} />
    <Route path="/sign-up" element={<SignUpPage />} />
    <Route path="/auth-redirect-native" element={<AuthRedirectNative />} />
    <Route path="/accept-invite" element={<AcceptInvite />} />
    <Route path="/join/:token" element={<JoinInvite />} />
    <Route path="/auth/google/callback" element={<GoogleCalendarCallback />} />
    <Route path="/legal/terms" element={<TermsOfService />} />
    <Route path="/legal/privacy" element={<PrivacyPolicy />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />
    <Sonner />
    <AuthProvider>
      <SupabaseCoupleProvider>
        <SupabaseNotesProvider>
          <BrowserRouter>
            <LanguageProvider>
              <AppLayout>
                <Routes>
                  {/* Spanish (Spain) routes */}
                  <Route path="/es-es/*" element={<AppRoutes />} />
                  {/* Italian routes */}
                  <Route path="/it-it/*" element={<AppRoutes />} />
                  {/* English (default) routes */}
                  <Route path="/" element={<Root />} />
                  <Route path="/landing" element={<Landing />} />
                  <Route path="/home" element={<Home />} />
                  <Route path="/lists" element={<Lists />} />
                  <Route path="/lists/:listId" element={<ListCategory />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/reminders" element={<Reminders />} />
                  <Route path="/onboarding" element={<Onboarding />} />
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/notes/:id" element={<NoteDetails />} />
                  <Route path="/sign-in" element={<SignInPage />} />
                  <Route path="/sign-up" element={<SignUpPage />} />
                  <Route path="/auth-redirect-native" element={<AuthRedirectNative />} />
                  <Route path="/accept-invite" element={<AcceptInvite />} />
                  <Route path="/join/:token" element={<JoinInvite />} />
                  <Route path="/auth/google/callback" element={<GoogleCalendarCallback />} />
                  <Route path="/legal/terms" element={<TermsOfService />} />
                  <Route path="/legal/privacy" element={<PrivacyPolicy />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
                <CookieConsentBanner />
              </AppLayout>
            </LanguageProvider>
          </BrowserRouter>
        </SupabaseNotesProvider>
      </SupabaseCoupleProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
