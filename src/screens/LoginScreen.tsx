import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import { useState, type FormEvent } from "react";
import { Hanger } from "../components/Hanger";

type LoginScreenProps = {
  client: SupabaseClient;
};

const CONNECTION_MESSAGE =
  "The app can't reach the sign-in service. Check your connection and try again.";

function signInMessage(error: AuthError): string {
  if (error.code === "invalid_credentials" || error.status === 400) {
    return "That email or password isn't right. Check both and try again.";
  }
  if (error.status === 429) {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }
  return CONNECTION_MESSAGE;
}

export function LoginScreen({ client }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) setMessage(signInMessage(error));
    } catch {
      setMessage(CONNECTION_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cover">
      <svg className="cover-rail" viewBox="0 0 375 112" aria-hidden="true">
        <line className="cover-rail-bar" x1="-4000" y1="32" x2="8000" y2="32" />
        <g transform="translate(0 27.5) scale(2.4)">
          <Hanger x={32} className="cover-hanger" />
        </g>
      </svg>

      <h1 className="cover-title">Wardrobe</h1>
      <p className="cover-line">Sign in to see this week's outfits.</p>

      <form className="login-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {message && (
          <p className="login-message" role="alert">
            {message}
          </p>
        )}

        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
