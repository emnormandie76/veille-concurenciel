import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import type { AuthorReport } from "@/lib/content-reports";

const STATUS_TONES: Record<string, BadgeTone> = {
  OPEN: "warning",
  RESOLVED: "success",
  REJECTED: "neutral",
};

/**
 * « Vos signalements » sur « Mon compte » (plan gestion-contenu, étape 6,
 * D36) : sans e-mail (G5), c'est ici que l'auteur suit la suite donnée à ses
 * signalements : l'état, et la réponse du gestionnaire s'il en a écrit une.
 * La page serveur ne lit que les signalements de la session.
 */
export default function MyReports({ reports }: { reports: AuthorReport[] }) {
  return (
    <Card aria-labelledby="account-reports-title" className="flex flex-col gap-4">
      <CardHeader
        title="Vos signalements"
        titleId="account-reports-title"
        description="Les informations que vous avez signalées aux gestionnaires, et la suite qu'ils y ont donnée."
      />
      {reports.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-2">
          Vous n&apos;avez envoyé aucun signalement. Le lien «&nbsp;Signaler une information&nbsp;» est sur chaque fiche d&apos;école et de
          programme.
        </p>
      ) : (
        <Table caption="Vos signalements, du plus récent au plus ancien">
          <THead>
            <Tr>
              <Th>Envoyé le</Th>
              <Th>Cible</Th>
              <Th>Catégorie</Th>
              <Th>État</Th>
              <Th>Réponse</Th>
            </Tr>
          </THead>
          <TBody>
            {reports.map((report) => (
              <Tr key={report.id}>
                <Td className="whitespace-nowrap">{report.created_label}</Td>
                <Td>
                  <div className="flex flex-col">
                    <span className="font-medium text-ink">{report.school_name}</span>
                    <span className="text-ink-2">{report.target}</span>
                  </div>
                </Td>
                <Td>{report.category_label}</Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={STATUS_TONES[report.status] ?? "neutral"}>{report.status_label}</Badge>
                    {report.handled_label && <span className="text-xs text-ink-2">le {report.handled_label}</span>}
                  </div>
                </Td>
                <Td className="max-w-[24rem] whitespace-pre-line">{report.response ?? <span className="text-ink-3">—</span>}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
