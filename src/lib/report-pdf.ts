// PDF real do relatório (sem depender do diálogo de impressão do navegador).
// Cabeçalho da empresa, tabela, totais, linha de assinatura e "Página X de Y" em todas as páginas.
import type { jsPDF as JsPdf } from "jspdf";

export interface ReportPdfInput {
  company: string;
  cnpj: string;
  establishment: string;
  title: string;
  periodText: string;
  emittedAt: string;
  emittedBy: string;
  header: string[];
  rows: string[][];
  totalRow?: string[];
  /** Colunas numéricas/monetárias (alinhadas à direita). */
  rightAligned: boolean[];
  signature?: boolean;
}

/** Relatórios largos saem em paisagem. */
export function isLandscape(columns: number): boolean {
  return columns > 7;
}

export async function buildReportPdf(input: ReportPdfInput): Promise<JsPdf> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const landscape = isLandscape(input.header.length);
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  doc.setFont("helvetica", "bold").setFontSize(13).text(input.company.toUpperCase(), margin, 14);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text(`CNPJ ${input.cnpj} · ${input.establishment}`, margin, 19);
  doc.setFont("helvetica", "bold").setFontSize(11).text(input.title, margin, 27);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text(`Período: ${input.periodText} · Emitido em ${input.emittedAt} por ${input.emittedBy}`, margin, 32);

  const body = input.totalRow ? [...input.rows, input.totalRow] : input.rows;
  const lastIndex = body.length - 1;
  autoTable(doc, {
    startY: 36,
    head: [input.header],
    body,
    margin: { left: margin, right: margin, bottom: 16 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: [15, 76, 92], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 249, 250] },
    columnStyles: Object.fromEntries(input.rightAligned.map((r, i) => [i, { halign: r ? "right" : "left" }])),
    didParseCell: (d) => {
      if (input.totalRow && d.section === "body" && d.row.index === lastIndex) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fillColor = [229, 236, 239];
      }
    },
  });

  if (input.signature) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = ((doc as any).lastAutoTable?.finalY ?? 40) + 22;
    if (y > pageH - 30) { doc.addPage(); y = 40; }
    doc.setFontSize(8.5).setDrawColor(60);
    const w = Math.min(70, (pageW - margin * 2 - 20) / 2);
    doc.line(margin, y, margin + w, y);
    doc.line(pageW - margin - w, y, pageW - margin, y);
    doc.text("Responsável pela contagem", margin, y + 4.5);
    doc.text("Conferido por", pageW - margin - w, y + 4.5);
    doc.text("Data: ____/____/________", margin, y + 12);
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5).setTextColor(110);
    doc.text(`${input.company} · ${input.title} · emitido em ${input.emittedAt}`, margin, pageH - 7);
    doc.text(`Página ${i} de ${total}`, pageW - margin, pageH - 7, { align: "right" });
    doc.setTextColor(0);
  }
  return doc;
}

export async function downloadReportPdf(fileName: string, input: ReportPdfInput): Promise<void> {
  const doc = await buildReportPdf(input);
  doc.save(`${fileName}.pdf`);
}
