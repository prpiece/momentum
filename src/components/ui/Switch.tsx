/** On/off toggle (.toggle): a button with role="switch", so Space and Enter work. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="toggle" />;
}
