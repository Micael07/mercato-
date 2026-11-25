import { redirect } from "next/navigation";
import { getRawSessionUser } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function TrocarSenhaPage() {
  const raw = await getRawSessionUser();
  if (!raw) redirect("/login");
  return (
    <ChangePasswordForm
      userName={raw.user.name}
      forced={raw.user.mustChangePassword}
      needsRecovery={!raw.user.recoveryConfigured}
    />
  );
}
