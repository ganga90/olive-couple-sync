import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";
import Lists from "./pages/Lists";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import NoteDetails from "./pages/NoteDetails";
import Welcome from "./pages/Welcome";
import ListCategory from "./pages/ListCategory";
import AcceptInvite from "./pages/AcceptInvite";
import NavBar from "./components/NavBar";
import MobileTabBar from "./components/MobileTabBar";
import { AuthProvider } from "./providers/AuthProvider";
import { SupabaseCoupleProvider } from "./providers/SupabaseCoupleProvider";
import { SupabaseNotesProvider } from "./providers/SupabaseNotesProvider";
import { SupabaseListsProvider } from "./providers/SupabaseListsProvider";
import SignInPage from "./pages/SignIn";
import SignUpPage from "./pages/SignUp";
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <SupabaseCoupleProvider>
          <SupabaseListsProvider>
            <SupabaseNotesProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/home" element={<><NavBar /><Index /><MobileTabBar /></>} />
                  <Route path="/lists" element={<><NavBar /><Lists /><MobileTabBar /></>} />
                  <Route path="/lists/:category" element={<><NavBar /><ListCategory /><MobileTabBar /></>} />
                  <Route path="/onboarding" element={<><NavBar /><Onboarding /><MobileTabBar /></>} />
                  <Route path="/welcome" element={<><NavBar /><Welcome /><MobileTabBar /></>} />
                  <Route path="/profile" element={<><NavBar /><Profile /><MobileTabBar /></>} />
                  <Route path="/notes/:id" element={<><NavBar /><NoteDetails /><MobileTabBar /></>} />
                  <Route path="/sign-in" element={<SignInPage />} />
                  <Route path="/sign-up" element={<SignUpPage />} />
                  <Route path="/accept-invite" element={<AcceptInvite />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </SupabaseNotesProvider>
          </SupabaseListsProvider>
        </SupabaseCoupleProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
