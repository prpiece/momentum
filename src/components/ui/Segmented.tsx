type Option<T> = { value: T; label: string };

/** Native radios underneath, so arrow keys and screen readers work without extra code. */
export function Segmented<T extends string | number>(props: {
  name: string;
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="inline-flex rounded-sm border border-border bg-bg p-0.5">
      {props.options.map((o) => (
        <label key={String(o.value)}>
          <input
            type="radio"
            name={props.name}
            className="peer sr-only"
            checked={o.value === props.value}
            onChange={() => props.onChange(o.value)}
          />
          <span className="block cursor-pointer select-none rounded-[6px] px-3 py-1 text-sm text-fg-2 transition-colors duration-[var(--dur)] hover:text-fg peer-checked:bg-surface-2 peer-checked:font-medium peer-checked:text-fg peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}
