import type { SupabaseClient } from "@supabase/supabase-js";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { PlanningProvider } from "./lib/planning";
import { StyleProvider } from "./lib/style";
import { useSession } from "./lib/useSession";
import { supabase } from "./lib/supabase";
import { WardrobeProvider } from "./lib/wardrobe";
import { CheckScreen } from "./screens/CheckScreen";
import { DayScreen } from "./screens/DayScreen";
import { LaundryScreen } from "./screens/LaundryScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { PieceScreen } from "./screens/PieceScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { StyleScreen } from "./screens/StyleScreen";
import { UsualWeekScreen } from "./screens/UsualWeekScreen";
import { WardrobeScreen } from "./screens/WardrobeScreen";
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
    <WardrobeProvider client={client}>
      <StyleProvider client={client}>
        <PlanningProvider client={client}>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell onSignOut={() => client.auth.signOut()} />}>
                <Route index element={<WeekScreen />} />
                <Route path="day/:day" element={<DayScreen />} />
                <Route path="week/usual" element={<UsualWeekScreen />} />
                <Route path="check" element={<CheckScreen />} />
                <Route path="wardrobe" element={<WardrobeScreen />} />
                <Route path="wardrobe/:pieceId" element={<PieceScreen />} />
                <Route path="style" element={<StyleScreen />} />
                <Route path="laundry" element={<LaundryScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </PlanningProvider>
      </StyleProvider>
    </WardrobeProvider>
  );
}
