// Everything prefixed VITE_ ships to the browser, so a secret key here would
// hand full database access to anyone who opens the app. Stop the build instead.
export function assertPublicKey(key: string | undefined): void {
  if (!key) return;

  if (key.startsWith("sb_secret_")) {
    throw new Error(secretKeyMessage);
  }

  const [, payload] = key.split(".");
  if (!payload) return;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.role === "service_role") throw new Error(secretKeyMessage);
  } catch (error) {
    if (error instanceof Error && error.message === secretKeyMessage) throw error;
  }
}

const secretKeyMessage =
  "VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key, which would be public in the browser. " +
  "Replace it with the publishable key (sb_publishable_...) or the legacy anon key.";
