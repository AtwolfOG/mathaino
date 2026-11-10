import { vi } from "vitest";

// Next.js enforces this import boundary; integration tests execute in plain Node.
vi.mock("server-only", () => ({}));
