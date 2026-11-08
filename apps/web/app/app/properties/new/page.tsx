import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canManageClients } from "@/lib/auth/permissions";
import { queryForSession } from "@/lib/db";
import { Card, PageContainer, PageHeader } from "@/components/ui";
import { PropertyForm } from "../PropertyForm";

export const dynamic = "force-dynamic";

interface ClientOption {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface PageProps {
  searchParams: Promise<{ client_id?: string }>;
}

export default async function NewPropertyPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageClients(session.role)) redirect("/app");

  const [{ client_id }, clients] = await Promise.all([
    searchParams,
    queryForSession<ClientOption>(session, `SELECT id, name FROM clients WHERE account_id = $1 ORDER BY name ASC`, [session.accountId]),
  ]);

  return (
    <PageContainer>
      <PageHeader title="New Site" backHref="/app/properties" backLabel="Sites" />
      <Card>
        <PropertyForm
          mode="create"
          actionUrl="/api/v1/properties"
          cancelHref="/app/properties"
          clients={clients}
          initialValues={{ client_id: client_id ?? "" }}
        />
      </Card>
    </PageContainer>
  );
}
