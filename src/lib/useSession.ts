import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

// undefined while the stored session is being read, null when signed out.
export function useSession(client: SupabaseClient): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(() => {
        if (active) setSession(null);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => setSession(next));

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  return session;
}
