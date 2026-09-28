import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDocument,
  deactivateUser,
  fetchAlerts,
  fetchReportOverview,
  listAuditEvents,
  listOrgUsers,
  markAlertRead,
  markAllAlertsRead,
  myProfile,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("C7 multipart upload API", () => {
  it("sends FormData without overriding the multipart boundary header", async () => {
    const form = new FormData();
    form.append("title", "Permit");
    form.append("category", "permit");
    const responseBody = { id: "doc-1", title: "Permit" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createDocument(form);

    expect(result).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/documents");
    expect(options.body).toBe(form);
    expect(options.headers).toMatchObject({ Accept: "application/json" });
    expect(options.headers).not.toHaveProperty("Content-Type");
  });
});

describe("Persistent notifications API", () => {
  it("applies recipient-center filters as query parameters", async () => {
    const responseBody = { items: [], total: 0, unread_count: 2, limit: 20, offset: 40 };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAlerts({ is_read: false, category: "plot", limit: 20, offset: 40 })).resolves.toEqual(responseBody);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/alerts?is_read=false&category=plot&limit=20&offset=40");
  });

  it("uses the persistent read and bulk-read endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ ok: true, updated_count: 3 }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await markAlertRead("alert-123");
    await markAllAlertsRead();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/alerts/alert-123/read",
      "/api/v1/alerts/read-all",
    ]);
  });
});

describe("C12 settings, audit and reports API", () => {
  it("uses the backend DELETE route to deactivate a member", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Utilisateur désactivé.", user_id: "user-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(deactivateUser("user-1")).resolves.toMatchObject({ user_id: "user-1" });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/users/user-1");
    expect(options.method).toBe("DELETE");
  });

  it("passes audit date, actor and action filters as query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listAuditEvents({
      object_type: "plot",
      action: "plot.updated",
      actor_user_id: "user-1",
      from_date: "2026-09-01",
      to_date: "2026-09-30",
      limit: 50,
      offset: 100,
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url, "http://arena.test");
    expect(parsed.pathname).toBe("/api/v1/audit-log");
    expect(parsed.searchParams.get("actor_user_id")).toBe("user-1");
    expect(parsed.searchParams.get("from_date")).toBe("2026-09-01");
    expect(parsed.searchParams.get("to_date")).toBe("2026-09-30");
    expect(parsed.searchParams.get("action")).toBe("plot.updated");
  });

  it("uses the organization-scoped settings and report endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ datasets: [], generated_at: "2026-09-28T00:00:00Z", notice: "internal" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    await myProfile();
    await listOrgUsers();
    await fetchReportOverview();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/users/me",
      "/api/v1/users/",
      "/api/v1/reports/overview",
    ]);
  });
});
