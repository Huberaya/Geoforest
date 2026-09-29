import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClerkSecurityControls } from "../../src/components/auth/ClerkSecurityControls";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  openUserProfile: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
  useClerk: () => ({ openUserProfile: mocks.openUserProfile }),
  // Simulated SDK dialog: actual hosted MFA still needs a human acceptance test.
  useReverification:
    (fetcher: () => Promise<{ verified?: boolean; clerk_error?: unknown }>) =>
    async () => {
      const first = await fetcher();
      if (!first.clerk_error) return first;
      await mocks.dialog();
      return fetcher();
    },
}));
let fetchMock: ReturnType<typeof vi.fn>;
let onVerified = vi.fn<() => void>();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getToken.mockResolvedValue("fictional-jwt");
  mocks.dialog.mockResolvedValue(undefined);
  fetchMock = vi.fn().mockResolvedValue(Response.json({ verified: true }));
  onVerified = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function view() {
  render(<ClerkSecurityControls onVerified={onVerified} />);
}
it("opens enrollment/account management, not an application role editor", () => {
  view();
  fireEvent.click(screen.getByRole("button", { name: "Sécurité du compte" }));
  expect(mocks.openUserProfile).toHaveBeenCalledOnce();
  expect(onVerified).not.toHaveBeenCalled();
});
it("requires backend confirmation before requesting a new application session", async () => {
  view();
  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier mon identité" }),
  );
  await waitFor(() => expect(onVerified).toHaveBeenCalledOnce());
  expect(mocks.getToken).toHaveBeenCalledWith({ skipCache: true });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/clerk/assurance");
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer fictional-jwt",
  );
});
it("rechecks with a fresh proof after the simulated MFA dialog", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce(
      Response.json(
        { clerk_error: { reason: "reverification-error" } },
        { status: 403 },
      ),
    )
    .mockResolvedValueOnce(Response.json({ verified: true }));
  view();
  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier mon identité" }),
  );
  await waitFor(() => expect(onVerified).toHaveBeenCalledOnce());
  expect(mocks.dialog).toHaveBeenCalledOnce();
  expect(mocks.getToken).toHaveBeenCalledTimes(2);
});
it.each([403, 401, 503])("fails closed on backend HTTP %s", async (status) => {
  fetchMock.mockResolvedValue(
    Response.json({ detail: "Fictional denial" }, { status }),
  );
  view();
  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier mon identité" }),
  );
  await screen.findByRole("alert");
  expect(onVerified).not.toHaveBeenCalled();
});
it("cancellation grants no application assurance", async () => {
  fetchMock.mockResolvedValue(
    Response.json({ clerk_error: {} }, { status: 403 }),
  );
  mocks.dialog.mockRejectedValue(new Error("Cancelled"));
  view();
  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier mon identité" }),
  );
  await screen.findByRole("alert");
  expect(onVerified).not.toHaveBeenCalled();
});
it("a successful dialog without subsequent server confirmation grants nothing", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce(Response.json({ clerk_error: {} }, { status: 403 }))
    .mockResolvedValueOnce(Response.json({ clerk_error: {} }, { status: 403 }));
  view();
  fireEvent.click(
    screen.getByRole("button", { name: "Vérifier mon identité" }),
  );
  await screen.findByRole("alert");
  expect(onVerified).not.toHaveBeenCalled();
});
