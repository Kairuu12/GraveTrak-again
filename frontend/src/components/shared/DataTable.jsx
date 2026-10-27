export default function DataTable({ columns, rows, getRowKey = (row, index) => row.id || index }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr>{columns.map(({ key, label }) => <th key={key}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={getRowKey(row, index)}>
              {columns.map(({ key, render }) => <td key={key}>{render ? render(row) : row[key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
