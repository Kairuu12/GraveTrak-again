import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportWorkbook } from './reportWorkbook.js';

test('staff workbook exports operational categories separately and retains every burial row', async () => {
  const report = { from: '2026-01-01', to: '2026-01-31', staff_operations: {
    generated_at: '2026-02-01T00:00:00Z',
    burials: Array.from({ length: 251 }, (_, i) => ({ reference: `R${i}`, deceased: '=literal', date: '2026-01-01', status: 'Scheduled', funeral_home: 'Home' })),
    sections: [{ cemetery: 'old', section: 'Section A', total: 4, available: 3, occupied: 1, reserved: 0, maintenance: 0, other: 0 }],
    maintenance: [], checks: [],
  } };
  const workbook = await buildReportWorkbook(report, 'staff');
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Burial Register', 'Slot Inventory', 'Maintenance', 'Record Checks']);
  assert.equal(workbook.getWorksheet('Burial Register').getCell('A257').value, 'R250');
  assert.equal(workbook.getWorksheet('Burial Register').getCell('B7').value, '=literal');
  assert.equal(workbook.getWorksheet('Slot Inventory').getCell('C7').value, 4);
  assert.match(workbook.getWorksheet('Maintenance').getCell('A5').value, /not repair history/);
});

test('Excel report retains typed values, styles, filters and literal names after reopening', async () => {
  const workbook = await buildReportWorkbook({ from: '2026-09-01', to: '2026-09-18', metrics: { burials: 2 }, records: [{ id: '00012', deceased_name: '=HYPERLINK("test")', event_date: '2026-09-10', status: 'slot_assigned' }], current_snapshot: { available_columbarium_slots: 25 } }, 'staff');
  const bytes = await workbook.xlsx.writeBuffer();
  const { default: ExcelJS } = await import('exceljs');
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  const records = reopened.getWorksheet('Records');
  assert.equal(records.getCell('A7').value, '00012');
  assert.equal(records.getCell('B7').value, '=HYPERLINK("test")');
  assert.equal(records.getCell('D7').value.toISOString().slice(0, 10), '2026-09-10');
  assert.equal(records.getCell('E7').value, 'Slot Assigned');
  assert.equal(records.getCell('A6').font.bold, true);
  assert.equal(records.views[0].ySplit, 6);
  assert.ok(records.autoFilter);
  assert.equal(reopened.getWorksheet('Summary').getCell('B7').value, 2);
  assert.equal(reopened.getWorksheet('Current Inventory').getCell('B7').value, 25);
});

test('empty period exports readable empty records sheet', async () => {
  const workbook = await buildReportWorkbook({ from: '2026-09-01', to: '2026-09-18', metrics: {}, records: [] }, 'mayor');
  assert.equal(workbook.getWorksheet('Records').getCell('A7').value, 'No records for this period.');
  assert.equal(workbook.getWorksheet('Records').getCell('D6').value, 'Submitted Date');
  assert.ok((await workbook.xlsx.writeBuffer()).byteLength > 0);
});

test('new staff reports export completed burials with actual-date labels', async () => {
  const workbook = await buildReportWorkbook({ from: '2026-01-01', to: '2026-01-31', staff_operations: {
    generated_at: '2026-02-01T00:00:00Z', burials_basis: 'actual_completion',
    burials: [{ reference: 'DONE-1', deceased: 'Test Person', date: '2026-01-02', status: 'Completed', funeral_home: 'Home' }],
    sections: [], maintenance: [], checks: [],
  } }, 'staff');
  assert.equal(workbook.getWorksheet('Burial Register'), undefined);
  const sheet = workbook.getWorksheet('Completed Burials');
  assert.equal(sheet.getCell('C6').value, 'Actual Burial Date');
  assert.equal(sheet.getCell('C7').value, '2026-01-02');
  assert.match(sheet.getCell('A5').value, /Confirmed completed burials/);
});
