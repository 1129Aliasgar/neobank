import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="Client access"
      title={
        <>
          Sign in to
          <br />
          <span className="italic text-ink/60">your ledger.</span>
        </>
      }
      lede="Use the email address on the account. If your business is still being verified, we will take you to the right place."
    >
      <LoginForm />
    </AuthShell>
  );
}
