import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Register a business",
};

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="New account"
      title={
        <>
          Open a
          <br />
          <span className="italic text-ink/60">business account.</span>
        </>
      }
      lede="Three minutes now, a verified account after review. You will complete the company's profile and identity check next."
    >
      <RegisterForm />
    </AuthShell>
  );
}
