import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PublicHome from "../../src/app/page";
import { AccountForm } from "../../src/components/auth/AccountForm";

const mocks = vi.hoisted(() => ({
  auth: { isLoaded: true },
  signIn: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => mocks.auth,
  SignIn: (props: unknown) => {
    mocks.signIn(props);
    return <div>Formulaire Clerk connexion</div>;
  },
  SignUp: (props: unknown) => {
    mocks.signUp(props);
    return <div>Formulaire Clerk inscription</div>;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.isLoaded = true;
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("public homepage offers registration and sign-in without SDK or backend calls", () => {
  render(<PublicHome />);
  expect(
    screen
      .getByRole("link", { name: "Se connecter en toute sécurité" })
      .getAttribute("href"),
  ).toBe("/sign-in");
  for (const link of screen.getAllByRole("link", {
    name: /Créer (un|mon) compte/,
  }))
    expect(link.getAttribute("href")).toBe("/sign-up");
  expect(
    screen
      .getByRole("link", { name: "Accéder à mon espace" })
      .getAttribute("href"),
  ).toBe("/espace");
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.signIn).not.toHaveBeenCalled();
  expect(mocks.signUp).not.toHaveBeenCalled();
});
it("retains a supplier entry independent of the account forms", () => {
  render(<PublicHome />);
  expect(
    screen
      .getByRole("link", { name: "Portail fournisseur" })
      .getAttribute("href"),
  ).toBe("/portail");
});
it.each(["sign-in", "sign-up"] as const)(
  "%s renders the proper Clerk component with same-site redirects",
  (mode) => {
    render(<AccountForm mode={mode} />);
    const mock = mode === "sign-in" ? mocks.signIn : mocks.signUp;
    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/${mode}`,
        routing: "path",
        forceRedirectUrl: "/espace",
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each(["sign-in", "sign-up"] as const)(
  "%s remains available without a business API or application session",
  (mode) => {
    render(<AccountForm mode={mode} />);
    expect(
      screen
        .getByRole("link", { name: "← Retour à l’accueil" })
        .getAttribute("href"),
    ).toBe("/");
    expect(
      screen
        .getByRole("link", {
          name: mode === "sign-in" ? "Créer un compte" : "Se connecter",
        })
        .getAttribute("href"),
    ).toBe(mode === "sign-in" ? "/sign-up" : "/sign-in");
    expect(fetch).not.toHaveBeenCalled();
  },
);
it.each(["sign-in", "sign-up"] as const)(
  "%s fails with a helpful message when SDK unavailable",
  async (mode) => {
    vi.useFakeTimers();
    mocks.auth.isLoaded = false;
    render(<AccountForm mode={mode} />);
    expect(screen.getByRole("status").textContent).toContain("Chargement");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(
      screen.getByRole("heading", { name: "Connexion indisponible" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  },
);
