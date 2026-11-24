import fs from 'node:fs';
import PDFDocument from 'pdfkit';

const NAVY = '#071b2b';
const GOLD = '#c69a43';
const CREAM = '#f7f5ef';
const MUTED = '#687982';
const INK = '#172b38';

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderCsv(report) {
  const lines = [];
  lines.push(csvCell('African Financial Trust — Trust Engine'));
  lines.push(csvCell(report.title));
  lines.push(csvCell(report.subtitle || ''));
  lines.push('');
  for (const item of report.meta || []) lines.push(`${csvCell(item.label)},${csvCell(item.value)}`);
  lines.push('');
  for (const section of report.sections || []) {
    lines.push(csvCell(section.heading));
    lines.push(section.columns.map(csvCell).join(','));
    for (const row of section.rows) lines.push(row.map(csvCell).join(','));
    lines.push('');
  }
  lines.push(csvCell('Limitations'));
  for (const note of report.limitations || []) lines.push(csvCell(note));
  return `${lines.join('\n')}\n`;
}

export function renderPdf(report, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true, info: { Title: report.title, Author: 'African Financial Trust' } });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    const width = doc.page.width - 84;

    // Header band
    doc.rect(0, 0, doc.page.width, 96).fill(NAVY);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9).text('AFRICAN FINANCIAL TRUST', 42, 30, { characterSpacing: 2 });
    doc.fillColor('#ffffff').fontSize(20).text(report.title, 42, 44, { width: width - 100 });
    doc.fillColor('#9fb3c0').font('Helvetica').fontSize(8).text('TRUST ENGINE', doc.page.width - 142, 30, { width: 100, align: 'right' });
    doc.fillColor('#ffffff').fontSize(10).text(report.subtitle || '', 42, 70, { width: width - 100 });
    doc.y = 120;

    // Meta
    doc.fillColor(INK).font('Helvetica').fontSize(9);
    for (const item of report.meta || []) {
      doc.font('Helvetica-Bold').text(`${item.label}: `, 42, doc.y, { continued: true });
      doc.font('Helvetica').text(String(item.value));
    }
    doc.moveDown(1);

    for (const section of report.sections || []) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.6);
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(11).text(section.heading.toUpperCase(), 42, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.25);
      doc.moveTo(42, doc.y).lineTo(42 + width, doc.y).strokeColor(GOLD).lineWidth(0.8).stroke();
      doc.moveDown(0.4);

      const columns = section.columns || [];
      const colWidth = width / Math.max(columns.length, 1);
      const padding = 4;

      const drawRow = (cells, { header = false } = {}) => {
        doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 7.5 : 7.5);
        const heights = cells.map((cell) => doc.heightOfString(String(cell ?? ''), { width: colWidth - padding * 2 }));
        const rowHeight = Math.max(...heights, 12) + padding * 2;
        if (doc.y + rowHeight > doc.page.height - 60) {
          doc.addPage();
        }
        const top = doc.y;
        if (header) doc.rect(42, top, width, rowHeight).fill(NAVY);
        else if (Math.round((top - 120) / 14) % 2 === 0) doc.rect(42, top, width, rowHeight).fill(CREAM);
        let x = 42;
        for (let i = 0; i < cells.length; i += 1) {
          doc.fillColor(header ? '#ffffff' : INK).text(String(cells[i] ?? ''), x + padding, top + padding, {
            width: colWidth - padding * 2,
            height: rowHeight,
            ellipsis: true,
          });
          x += colWidth;
        }
        doc.y = top + rowHeight;
      };

      drawRow(columns, { header: true });
      if (!section.rows.length) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8).text('No records for this section.', 42, doc.y + 4);
        doc.moveDown(1);
      } else {
        for (const row of section.rows) drawRow(row);
      }
    }

    doc.moveDown(1);
    if (doc.y > doc.page.height - 130) doc.addPage();
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('LIMITATIONS', 42, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(7.5);
    for (const note of report.limitations || []) {
      doc.text(`• ${note}`, 42, doc.y, { width });
      doc.moveDown(0.2);
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(
        `African Financial Trust — confidential. Page ${i + 1} of ${range.count}. Generated ${report.generatedAt.replace('T', ' ').slice(0, 19)} UTC.`,
        42,
        doc.page.height - 34,
        { width, align: 'center' },
      );
    }

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}
