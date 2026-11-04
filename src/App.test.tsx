import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

const signedIn = { access_token: "token" } as Session;

function fakeClient(options: {
  session?: Session | null;
  signInResult?: { error: { code?: string; status?: number } | null };
  signInThrows?: boolean;
}) {
  const signInWithPassword = vi.fn(async () => {
    if (options.signInThrows) throw new Error("offline");
    return { data: {}, ...(options.signInResult ?? { error: null }) };
  });
  const signOut = vi.fn(async () => ({ error: null }));

  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: options.session ?? null },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword,
      signOut,
    },
  } as unknown as SupabaseClient;

  return { client, signInWithPassword, signOut };
}

async function submitLogin() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), "test@example.test");
  await user.type(screen.getByLabelText("Password"), "test-value");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

describe("when the app has no database settings", () => {
  it("explains what to set instead of crashing", () => {
    render(<App client={null} />);

    expect(screen.getByText(/isn't connected to its database yet/)).toBeInTheDocument();
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeInTheDocument();
  });
});

describe("when signed out", () => {
  it("shows the sign-in form and hides the app", async () => {
    const { client } = fakeClient({ session: null });
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This week" })).not.toBeInTheDocument();
  });

  it("keeps every address behind the sign-in form", async () => {
    window.history.pushState({}, "", "/wardrobe");
    const { client } = fakeClient({ session: null });
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Wardrobe", level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("offers no way to create an account", async () => {
    const { client } = fakeClient({ session: null });
    render(<App client={client} />);

    await screen.findByRole("button", { name: "Sign in" });
    expect(screen.queryByText(/sign up|create account|register/i)).not.toBeInTheDocument();
  });

  it("sends the email and password to sign in", async () => {
    const { client, signInWithPassword } = fakeClient({ session: null });
    render(<App client={client} />);

    await submitLogin();

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "test@example.test",
      password: "test-value",
    });
  });

  it.each([
    ["wrong details", { code: "invalid_credentials", status: 400 }, /isn't right/],
    ["too many attempts", { code: "over_request_rate_limit", status: 429 }, /Too many/],
    ["an unreachable service", { status: 0 }, /can't reach/],
  ])("explains %s", async (_name, error, message) => {
    const { client } = fakeClient({ session: null, signInResult: { error } });
    render(<App client={client} />);

    await submitLogin();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("explains a failed request and lets you try again", async () => {
    const { client } = fakeClient({ session: null, signInThrows: true });
    render(<App client={client} />);

    await submitLogin();

    expect(await screen.findByRole("alert")).toHaveTextContent(/can't reach/);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});

describe("when signed in", () => {
  it("opens on this week with seven empty days", async () => {
    const { client } = fakeClient({ session: signedIn });
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "This week" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getAllByRole("img", { name: "No outfit planned" })).toHaveLength(7);
  });

  it("marks today", async () => {
    const { client } = fakeClient({ session: signedIn });
    render(<App client={client} />);

    expect(await screen.findByText(/Today$/)).toBeInTheDocument();
  });

  it("moves between the tabs", async () => {
    const user = userEvent.setup();
    const { client } = fakeClient({ session: signedIn });
    render(<App client={client} />);

    await user.click(await screen.findByRole("link", { name: "Laundry" }));

    expect(screen.getByRole("heading", { name: "Laundry" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/laundry");
  });

  it("sends an unknown address back to this week", async () => {
    window.history.pushState({}, "", "/nothing-here");
    const { client } = fakeClient({ session: signedIn });
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "This week" })).toBeInTheDocument();
  });

  it("signs out", async () => {
    const user = userEvent.setup();
    const { client, signOut } = fakeClient({ session: signedIn });
    render(<App client={client} />);

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledOnce();
  });
});
