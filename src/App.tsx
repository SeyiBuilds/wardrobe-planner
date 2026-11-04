import type { SupabaseClient } from "@supabase/supabase-js";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { useSession } from "./lib/useSession";
import { supabase } from "./lib/supabase";
import { LoginScreen } from "./screens/LoginScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { WeekScreen } from "./screens/WeekScreen";

type AppProps = {
  client?: SupabaseClient | null;
};

export function App({ client = supabase }: AppProps) {
  if (!client) return <SetupScreen />;
  return <AuthGate client={client} />;
}

function AuthGate({ client }: { client: SupabaseClient }) {
  const session = useSession(client);

  if (session === undefined) return <div className="loading" aria-busy="true" />;
  if (session === null) return <LoginScreen client={client} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell onSignOut={() => client.auth.signOut()} />}>
          <Route index element={<WeekScreen />} />
          <Route
            path="wardrobe"
            element={
              <PlaceholderScreen
                title="Wardrobe"
                body="Your clothes, shoes, watches and accessories will live here."
                note="Adding photos comes in phase 2."
              />
            }
          />
          <Route
            path="style"
            element={
              <PlaceholderScreen
                title="Style"
                body="Your written style guide and inspiration pictures will live here."
                note="Style comes in phase 4."
              />
            }
          />
          <Route
            path="laundry"
            element={
              <PlaceholderScreen
                title="Laundry"
                body="Worn pieces wait here until you mark them clean."
                note="The weekly check comes in phase 3."
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
