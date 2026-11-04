export function SetupScreen() {
  return (
    <div className="cover">
      <h1 className="cover-title">Wardrobe</h1>
      <p className="cover-line">This app isn't connected to its database yet.</p>
      <p className="cover-note">
        Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the project's environment
        variables, then deploy again.
      </p>
    </div>
  );
}
