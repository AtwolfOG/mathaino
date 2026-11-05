import { expect, test, vi } from "vitest";
import { GET } from "@/app/api/health/route";

test("health reports uncached application liveness without a database", async () => {
  vi.stubEnv("DATABASE_URL", undefined);

  const response = GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
