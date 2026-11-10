"use client";
import { useState } from "react";
import { navigateAfterAuthentication } from "./navigation";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        setError("Sign-out failed. Try again.");
        return;
      }
      navigateAfterAuthentication("/login");
    } catch {
      setError("Sign-out failed. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        className="auth-secondary"
        type="button"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      <p className="auth-error" role="alert">
        {error}
      </p>
    </div>
  );
}
