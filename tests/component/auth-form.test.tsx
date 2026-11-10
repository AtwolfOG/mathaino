import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthForm } from "@/ui/authentication/auth-form";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/ui/authentication/navigation", () => ({
  navigateAfterAuthentication: navigate,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  navigate.mockReset();
});

test("registration fields have visible accessible labels and appropriate autocomplete and bounds", () => {
  render(<AuthForm mode="register" />);
  expect(screen.getByLabelText("Name", { exact: true })).toHaveAttribute(
    "autocomplete",
    "name",
  );
  expect(screen.getByLabelText("Email", { exact: true })).toHaveAttribute(
    "type",
    "email",
  );
  const password = screen.getByLabelText("Password", { exact: true });
  expect(password).toHaveAttribute("autocomplete", "new-password");
  expect(password).toHaveAttribute("minlength", "12");
  expect(password).toHaveAttribute("maxlength", "128");
  expect(
    screen.getByRole("button", { name: "Create account" }),
  ).toHaveAttribute("type", "submit");
});

test("successful login uses JSON and a fixed internal destination", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  render(<AuthForm mode="login" />);
  fireEvent.change(screen.getByLabelText("Email", { exact: true }), {
    target: { value: "alice@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "Fixture-password-2026!" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/practice"));
  expect(fetch).toHaveBeenCalledWith(
    "/api/auth/sign-in/email",
    expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
  );
});

test("invalid credentials are announced and keep the form available for retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      ),
    ),
  );
  render(<AuthForm mode="login" />);
  fireEvent.change(screen.getByLabelText("Email", { exact: true }), {
    target: { value: "alice@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "Fixture-password-2026!" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Email or password is incorrect.",
    ),
  );
  expect(screen.getByRole("alert")).toHaveFocus();
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
});
