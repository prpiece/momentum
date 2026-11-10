type Option<T> = { value: T; label: string; disabled?: boolean };

/** Native radios underneath, so arrow keys and screen readers work without extra code. */
export function Segmented<T extends string | number>(props: {
  name: string;
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="seg">
      {props.options.map((o) => (
        // `relative` keeps the sr-only radio inside the label; otherwise focusing it scrolls <main> to wherever it lands.
        <label key={String(o.value)} className={`relative ${o.disabled ? "opacity-50" : ""}`}>
          <input
            type="radio"
            name={props.name}
            className="peer sr-only"
            checked={o.value === props.value}
            disabled={o.disabled}
            onChange={() => props.onChange(o.value)}
          />
          <span className={`seg-item peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-text ${o.value === props.value ? "is-on" : ""}`}>
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}
