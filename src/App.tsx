import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Root from "./pages/Root";
import Home from "./pages/Home";
import Index from "./pages/Index";
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
import NavBar from "./components/NavBar";
import { MobileLayout } from "./components/MobileLayout";
import { AuthProvider } from "./providers/AuthProvider";
import { SupabaseCoupleProvider } from "./providers/SupabaseCoupleProvider";
import { SupabaseNotesProvider } from "./providers/SupabaseNotesProvider";
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
          <SupabaseNotesProvider>
            <BrowserRouter>
              <NavBar />
              <MobileLayout>
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
                  <Route path="/accept-invite" element={<AcceptInvite />} />
                  <Route path="/join/:token" element={<JoinInvite />} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </MobileLayout>
            </BrowserRouter>
          </SupabaseNotesProvider>
        </SupabaseCoupleProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
