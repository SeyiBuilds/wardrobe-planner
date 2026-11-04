import { NavLink, Outlet } from "react-router";

type AppShellProps = {
  onSignOut: () => void;
};

const TABS = [
  { to: "/", label: "This week", end: true },
  { to: "/wardrobe", label: "Wardrobe", end: false },
  { to: "/style", label: "Style", end: false },
  { to: "/laundry", label: "Laundry", end: false },
];

export function AppShell({ onSignOut }: AppShellProps) {
  return (
    <div className="shell">
      <header className="shell-header">
        <button type="button" className="text-button" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="tabs" aria-label="Main">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="tab">
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
