import { AuthForm } from "@/ui/authentication/auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <>
      {params.registered === "1" ? (
        <p role="status" className="auth-notice">
          Your account is ready. Sign in to continue.
        </p>
      ) : null}
      <AuthForm mode="login" />
    </>
  );
}
