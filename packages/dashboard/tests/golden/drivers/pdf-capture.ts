/**
 * Passthrough capture for the two PDF generators (never golden PDF bytes).
 *
 * Golden test files vi.mock('../../src/pdf/generator.js') so that
 * generatePdfFromData / generateVpatPdf record their ARGUMENTS here and return
 * a tiny Buffer. The recorded arguments are the observable "PDF data" of the
 * report.pdf export, the notification PDF and the fleet-report VPAT input.
 */
const captured: { report: unknown[]; vpat: unknown[] } = { report: [], vpat: [] };

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function resetPdfCapture(): void {
  captured.report = [];
  captured.vpat = [];
}

export function capturedReportPdfCalls(): readonly unknown[] {
  return captured.report;
}

export function capturedVpatPdfCalls(): readonly unknown[] {
  return captured.vpat;
}

export async function captureReportPdf(scanMeta: unknown, reportData: unknown): Promise<Buffer> {
  captured.report.push(snapshot({ scanMeta, reportData }));
  return Buffer.from('golden-report-pdf');
}

export async function captureVpatPdf(scanMeta: unknown, vpat: unknown): Promise<Buffer> {
  captured.vpat.push(snapshot({ scanMeta, vpat }));
  return Buffer.from('golden-vpat-pdf');
}
