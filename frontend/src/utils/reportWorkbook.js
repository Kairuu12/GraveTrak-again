const titleCase = value => String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const dateValue = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : String(value || '');
};

export async function buildReportWorkbook(report, role) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GraveTrak';
  workbook.created = new Date();
  workbook.title = `Cemetery Report ${report.from} to ${report.to}`;
  const green = 'FF16634D';
  const ink = 'FF243B34';
  const pale = 'FFEAF4EF';
  function sheet(name, widths) {
    const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 6 }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = widths.map(width => ({ width }));
    ws.mergeCells(1, 1, 1, widths.length);
    ws.getCell('A1').value = 'GraveTrak | Cemetery Report';
    ws.getCell('A1').font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
    ws.getRow(1).height = 38;
    ws.mergeCells(2, 1, 2, widths.length);
    ws.getCell('A2').value = role === 'mayor' ? "City Mayor's Office · Operations Report" : 'Cemetery Staff · Operations Report';
    ws.getCell('A3').value = 'Period start'; ws.getCell('B3').value = dateValue(report.from); ws.getCell('B3').numFmt = 'mmm d, yyyy';
    ws.getCell('A4').value = 'Period end'; ws.getCell('B4').value = dateValue(report.to); ws.getCell('B4').numFmt = 'mmm d, yyyy';
    ws.mergeCells(5, 1, 5, widths.length);
    ws.getCell('A5').value = 'Generated: ' + new Date().toLocaleString('en-PH');
    ws.getCell('A5').font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF61756C' } };
    ws.pageSetup.printTitlesRow = '1:6';
    ws.headerFooter.oddFooter = '&LGraveTrak&CPage &P of &N';
    return ws;
  }
  function header(ws, row, values) {
    ws.getRow(row).values = values;
    ws.getRow(row).height = 26;
    ws.getRow(row).eachCell(cell => {
      cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  }
  function body(ws, row, values, stripe) {
    ws.getRow(row).values = values;
    ws.getRow(row).height = 32;
    ws.getRow(row).eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: ink } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stripe ? pale : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE7E1' } } };
    });
  }
  if (report.staff_operations) {
    const data = report.staff_operations;
    const completed = data.burials_basis === 'actual_completion';
    const tables = [
      [completed ? 'Completed Burials' : 'Burial Register', ['Reference', 'Deceased', completed ? 'Actual Burial Date' : 'Scheduled Burial Date', 'Status', 'Funeral Home'], data.burials.map(row => [row.reference, row.deceased, row.date, row.status, row.funeral_home]), completed ? 'Confirmed completed burials by actual burial date in the selected period; excludes pending applications and scheduled burials.' : 'Previous report: applications with scheduled burial dates; a date alone does not confirm completion.'],
      ['Slot Inventory', ['Cemetery', 'Section', 'Total', 'Available', 'Occupied', 'Reserved', 'Maintenance', 'Other'], data.sections.map(row => [row.cemetery, row.section, row.total, row.available, row.occupied, row.reserved, row.maintenance, row.other]), 'Current niche inventory at generation time. Saved layouts are excluded from slot capacity.'],
      ['Maintenance', ['Reference', 'Type', 'Cemetery', 'Section', 'Position', 'Notes'], data.maintenance.map(row => [row.reference, row.kind, row.cemetery, row.section, row.position, row.notes]), 'Current maintenance follow-up, not repair history for the selected period.'],
      ['Record Checks', ['Reference', 'Cemetery', 'Section', 'Position', 'Recorded Occupant', 'Review Reason'], data.checks.map(row => [row.reference, row.cemetery, row.section, row.position, row.occupant, row.reason]), 'Current occupied niches needing review. Death dates are detected from recorded name annotations.'],
    ];
    for (const [name, headings, rows, note] of tables) {
      const ws = sheet(name, headings.map(() => 26));
      ws.pageSetup.orientation = 'landscape';
      ws.getCell('A2').value = 'Cemetery Staff · Operations Report';
      ws.getCell('A5').value = `${note} Snapshot: ${data.generated_at}`;
      ws.getRow(5).height = 42;
      ws.getCell('A5').alignment = { wrapText: true };
      header(ws, 6, headings);
      rows.forEach((row, index) => body(ws, index + 7, row, index % 2 === 0));
      if (rows.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: rows.length + 6, column: headings.length } };
      else ws.getCell('A7').value = 'No records in this report category.';
    }
    return workbook;
  }
  const summary = sheet('Summary', [44, 26]);
  header(summary, 6, ['Activity during selected period', 'Count']);
  Object.entries(report.metrics || {}).forEach(([metric, value], index) => {
    body(summary, index + 7, [titleCase(metric), value], index % 2 === 0);
    summary.getCell(index + 7, 2).numFmt = '#,##0';
  });
  const records = sheet('Records', [26, 42, 30, 24, 30]);
  header(records, 6, ['Application ID', 'Deceased Name', 'Funeral Home', role === 'mayor' ? 'Submitted Date' : 'Burial Date', 'Status']);
  (report.records || []).forEach((record, index) => {
    // Explicit strings are stored as text, never interpreted as Excel formulas.
    body(records, index + 7, [String(record.id ?? ''), String(record.deceased_name ?? ''), String(record.funeral_home ?? 'Not provided'), dateValue(record.event_date), titleCase(record.status)], index % 2 === 0);
    records.getCell(index + 7, 4).numFmt = 'mmm d, yyyy';
    records.getRow(index + 7).height = Math.max(32, Math.ceil(String(record.deceased_name || '').length / 40) * 16);
  });
  if (report.records?.length) records.autoFilter = { from: 'A6', to: `E${report.records.length + 6}` };
  else { records.mergeCells('A7:E7'); records.getCell('A7').value = 'No records for this period.'; }
  if (report.funeral_home_breakdown) {
    const funeralHomes = sheet('Funeral Homes', [46, 20, 20]);
    funeralHomes.getCell('A5').value = 'All funeral homes represented by applications in the selected reporting period.';
    funeralHomes.getRow(5).height = 30; funeralHomes.getCell('A5').alignment = { wrapText: true };
    header(funeralHomes, 6, ['Funeral Home', 'Applications', 'Share']);
    const totalFuneralApplications = report.funeral_home_breakdown.reduce((sum, item) => sum + Number(item.count || 0), 0);
    report.funeral_home_breakdown.forEach((item, index) => {
      const count = Number(item.count || 0);
      body(funeralHomes, index + 7, [String(item.funeral_home || 'Not provided'), count, totalFuneralApplications ? count / totalFuneralApplications : 0], index % 2 === 0);
      funeralHomes.getCell(index + 7, 2).numFmt = '#,##0';
      funeralHomes.getCell(index + 7, 3).numFmt = '0.0%';
    });
    if (report.funeral_home_breakdown.length) funeralHomes.autoFilter = { from: 'A6', to: `C${report.funeral_home_breakdown.length + 6}` };
    else funeralHomes.getCell('A7').value = 'No funeral home applications found for this period.';
  }
  if (report.current_snapshot) {
    const inventory = sheet('Current Inventory', [44, 26]);
    inventory.getCell('A5').value = 'Inventory returned when this report was generated; not a historical period snapshot.';
    inventory.getRow(5).height = 32; inventory.getCell('A5').alignment = { wrapText: true };
    header(inventory, 6, ['Current inventory', 'Count']);
    Object.entries(report.current_snapshot).filter(([, value]) => typeof value === 'number').forEach(([key, value], index) => {
      body(inventory, index + 7, [titleCase(key.replace('columbarium_slots', 'apartment_niches')), value], index % 2 === 0);
      inventory.getCell(index + 7, 2).numFmt = '#,##0';
    });
  }
  if (report.application_records) {
    const applications = sheet('Applications', [24, 34, 28, 32, 28, 20, 20, 20, 20]);
    applications.pageSetup.orientation = 'landscape';
    applications.getCell('A5').value = 'Applications with activity during the period. Status reflects report generation time.';
    header(applications, 6, ['Application ID', 'Deceased', 'Applicant', 'Funeral Home', 'Current Status', 'Submitted', 'Approved', 'Rejected', 'Burial Date']);
    report.application_records.forEach((row, index) => {
      body(applications, index + 7, [String(row.id), row.deceased_name, row.applicant_name, row.funeral_home || 'Not provided', row.status, ...['submitted_date', 'approved_date', 'rejected_date', 'burial_date'].map(key => dateValue(row[key]))], index % 2 === 0);
      for (let column = 6; column <= 9; column++) applications.getCell(index + 7, column).numFmt = 'mmm d, yyyy';
    });
    if (report.application_records.length) applications.autoFilter = { from: 'A6', to: `I${report.application_records.length + 6}` };
    else applications.getCell('A7').value = 'No application activity during this period.';
  }
  return workbook;
}

export async function downloadReportWorkbook(report, role) {
  const workbook = await buildReportWorkbook(report, role);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `GraveTrak_Report_${report.from}_${report.to}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
