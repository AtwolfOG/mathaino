"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { navigateAfterAuthentication } from "./navigation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const title = registering ? "Create account" : "Sign in";
  const prefix = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        registering ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: fields.get("email"),
            password: fields.get("password"),
            ...(registering
              ? { name: fields.get("name") }
              : { rememberMe: true }),
          }),
        },
      );
      if (response.ok) {
        navigateAfterAuthentication(
          registering ? "/login?registered=1" : "/practice",
        );
        return;
      }
      setError(
        response.status === 401
          ? "Email or password is incorrect."
          : response.status === 429
            ? "Too many attempts. Try again shortly."
            : response.status >= 500
              ? "Authentication is temporarily unavailable. Try again."
              : "Check your details and try again.",
      );
    } catch {
      setError("Authentication is temporarily unavailable. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="auth-heading" id={`${prefix}-heading`}>
        {title}
      </h1>
      <p className="auth-introduction">
        {registering
          ? "Keep your Bible practice with you."
          : "Continue your Bible practice."}
      </p>
      <form
        method="post"
        action={
          registering ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email"
        }
        aria-labelledby={`${prefix}-heading`}
        aria-busy={pending}
        onSubmit={submit}
        className="auth-form"
      >
        {registering ? (
          <div className="auth-field">
            <label htmlFor={`${prefix}-name`}>Name</label>
            <input
              id={`${prefix}-name`}
              name="name"
              autoComplete="name"
              maxLength={100}
              required
            />
          </div>
        ) : null}
        <div className="auth-field">
          <label htmlFor={`${prefix}-email`}>Email</label>
          <input
            id={`${prefix}-email`}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor={`${prefix}-password`}>Password</label>
          <input
            id={`${prefix}-password`}
            name="password"
            type="password"
            autoComplete={registering ? "new-password" : "current-password"}
            minLength={12}
            maxLength={128}
            aria-describedby={`${prefix}-password-help`}
            required
          />
          <p className="auth-help" id={`${prefix}-password-help`}>
            {registering
              ? "Use 12–128 characters."
              : "Use the password for your account."}
          </p>
        </div>
        <p className="auth-error" role="alert" ref={errorRef} tabIndex={-1}>
          {error}
        </p>
        <button className="auth-submit" type="submit" disabled={pending}>
          {pending
            ? registering
              ? "Creating account…"
              : "Signing in…"
            : title}
        </button>
      </form>
      <p className="auth-alternative">
        {registering ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New to Mathaino? <Link href="/register">Create an account</Link>
          </>
        )}
      </p>
    </>
  );
}
