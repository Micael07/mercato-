import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { PublicationPanel } from "@/components/deployment/publication-panel";

export const dynamic = "force-dynamic";

export default async function PublicationPage() {
  const context = await getAuthContext();
  if (!context || context.membership.roleCode !== "admin" || !context.permissions.has("settings.manage")) {
    notFound();
  }
  return <PublicationPanel />;
}
