export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <button className={`toggle ${checked ? "is-on" : ""}`} type="button" onClick={onChange} aria-pressed={checked}>
      {label ? <span className="sr-only">{label}</span> : null}
      <span />
    </button>
  );
}
