import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClerkSessionBridge } from "../../src/components/auth/ClerkSessionBridge";
import { useAuthSession } from "../../src/components/auth/AuthSession";

const mocks = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_synthetic",
    sessionId: "sess_synthetic",
    getToken: vi.fn(),
  },
  clerk: { signOut: vi.fn() },
  router: { replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => mocks.auth,
  useClerk: () => mocks.clerk,
  useReverification: (fetcher: () => Promise<unknown>) => fetcher,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
function Workspace() {
  const auth = useAuthSession();
  return (
    <>
      <h2>Espace métier vérifié</h2>
      <span data-testid="generation">{auth.generation}</span>
      <button
        onClick={() => {
          void auth.logout().catch(() => {});
        }}
      >
        Déconnexion
      </button>
    </>
  );
}
const view = () => (
  <ClerkSessionBridge>
    <Workspace />
  </ClerkSessionBridge>
);
let fetchMock: ReturnType<typeof vi.fn>;
const payload = (csrf = "synthetic-csrf") => ({
  csrf_token: csrf,
  expires_at: Math.floor(Date.now() / 1000) + 55,
  user_id: "synthetic-uuid",
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.auth, {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_synthetic",
    sessionId: "sess_synthetic",
  });
  mocks.auth.getToken.mockResolvedValue("synthetic-jwt");
  mocks.clerk.signOut.mockResolvedValue(undefined);
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/logout")
      ? new Response(null, { status: 204 })
      : Response.json(payload()),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Clerk bridge with simulated SDK and HTTP only", () => {
  it("waits for a verified backend exchange before rendering business UI", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    render(view());
    expect(screen.queryByText("Espace métier vérifié")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolve(Response.json(payload()));
    });
    expect(screen.getByText("Espace métier vérifié")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/clerk/exchange");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer synthetic-jwt",
    );
    expect(mocks.auth.getToken).toHaveBeenCalledWith({ skipCache: true });
  });
  it.each([401, 403, 429, 503])(
    "fails closed on backend status %s",
    async (status) => {
      fetchMock.mockResolvedValue(new Response(null, { status }));
      render(view());
      await screen.findByText("Connexion indisponible");
      expect(screen.queryByText("Espace métier vérifié")).toBeNull();
      expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
    },
  );
  it("fails closed when the SDK has no token", async () => {
    mocks.auth.getToken.mockResolvedValue(null);
    render(view());
    await screen.findByText("Connexion indisponible");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("clears an old local cookie when Clerk is signed out", async () => {
    mocks.auth.isSignedIn = false;
    render(view());
    await screen.findByText("Espace métier vérifié");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/clerk/logout");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "X-GFT-Logout": "1" });
    expect(mocks.auth.getToken).not.toHaveBeenCalled();
  });
  it("does not change CSRF generation on ordinary renewals", async () => {
    vi.useFakeTimers();
    render(view());
    await act(async () => {});
    expect(screen.getByTestId("generation").textContent).toBe("1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("generation").textContent).toBe("1");
  });
  it("refreshes consumers when a new local CSRF is issued", async () => {
    vi.useFakeTimers();
    render(view());
    await act(async () => {});
    fetchMock.mockResolvedValueOnce(Response.json(payload("second-csrf")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(screen.getByTestId("generation").textContent).toBe("2");
  });
  it("times out an unavailable SDK without opening business UI", async () => {
    vi.useFakeTimers();
    mocks.auth.isLoaded = false;
    render(view());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByText("Connexion indisponible")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds a stuck getToken call", async () => {
    vi.useFakeTimers();
    mocks.auth.getToken.mockImplementation(() => new Promise(() => {}));
    render(view());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12001);
    });
    expect(screen.getByText("Connexion indisponible")).toBeTruthy();
  });
  it("closes local and Clerk sessions and stops renewal on logout", async () => {
    vi.useFakeTimers();
    render(view());
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByText("Déconnexion"));
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/clerk/logout");
    expect(mocks.clerk.signOut).toHaveBeenCalledOnce();
    expect(mocks.router.replace).toHaveBeenCalledWith("/");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("hides the previous user workspace while another identity is verified", async () => {
    const r = render(view());
    await screen.findByText("Espace métier vérifié");
    mocks.auth.userId = "user_other";
    mocks.auth.getToken.mockImplementation(() => new Promise(() => {}));
    r.rerender(view());
    expect(screen.queryByText("Espace métier vérifié")).toBeNull();
  });
  it("reports failure if Clerk logout cannot be confirmed", async () => {
    render(view());
    await screen.findByText("Espace métier vérifié");
    mocks.clerk.signOut.mockRejectedValueOnce(
      new Error("synthetic provider details"),
    );
    fireEvent.click(screen.getByText("Déconnexion"));
    await screen.findByText("Connexion indisponible");
    expect(screen.queryByText("synthetic provider details")).toBeNull();
  });
  it("still attempts Clerk logout when local revocation fails", async () => {
    render(view());
    await screen.findByText("Espace métier vérifié");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    fireEvent.click(screen.getByText("Déconnexion"));
    await screen.findByText("Connexion indisponible");
    expect(mocks.clerk.signOut).toHaveBeenCalledOnce();
  });
});

it("routes production through the bridge without a development disclaimer", async () => {
  render(
    <ClerkSessionBridge provider="clerk_production">
      <Workspace />
    </ClerkSessionBridge>,
  );
  await screen.findByText("Espace métier vérifié");
  expect(screen.queryByText(/Environnement de test local/)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Vérifier mon identité" }),
  ).toBeTruthy();
});
