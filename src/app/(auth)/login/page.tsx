import { LoginForm } from "@/components/auth/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const contact = process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim();
  const notice =
    motivo === "licenca"
      ? `O acesso desta empresa não está liberado ou a licença venceu.${contact ? ` Contato: ${contact}.` : ""}`
      : null;
  return (
    <LoginForm
      demoEnabled={
        process.env.DEPLOYMENT_TARGET !== "public" &&
        process.env.NEXT_PUBLIC_ENABLE_DEMO === "true"
      }
      registrationEnabled={process.env.ALLOW_PUBLIC_REGISTRATION !== "false"}
      notice={notice}
    />
  );
}
