export default function SearchBar({ value, onChange, placeholder = 'Search…', className = '' }) {
  return (
    <input
      className={`field-input ${className}`.trim()}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}
