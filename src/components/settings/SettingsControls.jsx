// Building blocks shared by the Settings page and its sections.

// A card inside a settings tab, labelled by its visible heading.
export function Section({ id, icon: Icon, title, description, children }) {
  return (
    <section className="bg-white rounded-xl shadow p-4 md:p-6 min-w-0" aria-labelledby={id} data-testid={id}>
      <div className="flex items-start gap-3 mb-4">
        {Icon &&
          <div className="bg-blue-50 text-blue-700 rounded-lg p-2 shrink-0">
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
        }
        <div className="min-w-0">
          <h2 className="font-bold text-gray-800 text-lg" id={id}>{title}</h2>
          {description && <p className="text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

// A selectable card wrapping a native radio or checkbox (keyboard and screen readers work natively).
export function Choice({ type, name, checked, disabled, onChange, label, hint, lang, testId }) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50"} ${checked ? "border-blue-400 bg-blue-50/60" : "border-gray-200"}`}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        data-testid={testId}
        className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium text-gray-800" lang={lang}>{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

// A labelled group of radio choices (one setting). labelHidden keeps the label for screen readers
// only, when the card's title already says the same thing.
export function RadioGroup({ id, label, labelHidden = false, hint, options, value, onChange, columns = "sm:grid-cols-2" }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className={labelHidden ? "sr-only" : "text-sm font-semibold text-gray-700"} id={`${id}-label`}>{label}</h3>
      {hint && <p className="text-xs text-gray-500 mb-2" id={`${id}-hint`}>{hint}</p>}
      <div className={`grid gap-2 mt-2 ${columns}`} role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map((option) =>
          <Choice
            key={String(option.value)}
            type="radio"
            name={id}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
            label={option.label}
            hint={option.hint}
            lang={option.lang}
            testId={`${id}-${option.value}`} />
        )}
      </div>
    </div>
  );
}
