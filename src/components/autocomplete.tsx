import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  Button,
  ComboBox,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";

import "../styles/autocomplete.css";

export interface AutocompleteOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const optionText = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join("");

const optionsFromChildren = (children: ReactNode): AutocompleteOption[] =>
  Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === Fragment)
      return optionsFromChildren(child.props.children);
    const label = optionText(child.props.children);
    return [
      {
        value: String(child.props.value ?? label),
        label,
        disabled: child.props.disabled,
      },
    ];
  });

type AutocompleteSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "onBlur" | "multiple" | "size"
> & {
  onValueChange?: (value: string) => void;
  onBlur?: () => void;
  inputSize?: number;
  placeholder?: string;
};

export const AutocompleteSelect = ({
  children,
  value,
  defaultValue,
  onValueChange,
  onBlur,
  name,
  id,
  disabled,
  required,
  className,
  inputSize,
  placeholder,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: AutocompleteSelectProps) => {
  const options = optionsFromChildren(children);
  const initialValue = String(defaultValue ?? options[0]?.value ?? "");
  const [internalValue, setInternalValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = String(value ?? internalValue);
  const selectedLabel = selected
    ? (options.find((option) => option.value === selected)?.label ?? "")
    : "";
  const initialLabel = initialValue
    ? (options.find((option) => option.value === initialValue)?.label ?? "")
    : "";
  const [query, setQuery] = useState(selectedLabel);
  useEffect(() => setQuery(selectedLabel), [selectedLabel]);
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => {
      setInternalValue(initialValue);
      setQuery(initialLabel);
      inputRef.current?.blur();
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [value, initialValue, initialLabel]);
  const visible =
    query === selectedLabel
      ? options
      : options.filter((option) =>
          option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        );
  const select = (next: string) => {
    if (!options.some((option) => option.value === next && !option.disabled))
      return;
    setInternalValue(next);
    setQuery(options.find((option) => option.value === next)?.label ?? "");
    onValueChange?.(next);
  };
  return (
    <>
      {name && (
        <input type="hidden" name={name} value={selected} disabled={disabled} />
      )}
      <ComboBox
        className={["folio-autocomplete", className].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        menuTrigger="focus"
        isDisabled={disabled}
        isRequired={required}
        isInvalid={Boolean(invalid) && invalid !== "false" ? true : undefined}
        validationBehavior="native"
        validate={() =>
          required &&
          !options.some(
            (option) =>
              option.value === selected && selected !== "" && !option.disabled,
          )
            ? "Choose one of the listed options."
            : null
        }
        inputValue={query}
        selectedKey={selected || null}
        onInputChange={setQuery}
        onSelectionChange={(key) => {
          if (key !== null) select(String(key));
        }}
        onBlur={() => {
          setQuery(selectedLabel);
          onBlur?.();
        }}
        allowsEmptyCollection
      >
        <div className="autocomplete-input-row">
          <Input
            ref={inputRef}
            id={id}
            size={inputSize}
            placeholder={
              placeholder ??
              options.find((option) => option.value === "")?.label
            }
          />
          <Button
            type="button"
            aria-label={`Show ${ariaLabel ?? "available"} options`}
          >
            ⌄
          </Button>
        </div>
        <Popover className="autocomplete-popover" isNonModal>
          <ListBox
            items={visible.map((option) => ({ ...option, id: option.value }))}
            disabledKeys={options
              .filter((option) => option.disabled)
              .map((option) => option.value)}
            renderEmptyState={() => "No matching options"}
          >
            {(option) => (
              <ListBoxItem textValue={option.label}>{option.label}</ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
    </>
  );
};

export const CreatableAutocomplete = ({
  id,
  "aria-label": ariaLabel,
  value,
  options,
  onValueChange,
  disabled,
  required,
  maxLength,
  placeholder,
}: {
  id?: string;
  "aria-label": string;
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) => {
  const query = value.trim().toLocaleLowerCase();
  const visibleOptions = options.filter(
    (option) => !query || option.toLocaleLowerCase().includes(query),
  );

  return (
    <ComboBox
      className="folio-autocomplete"
      aria-label={ariaLabel}
      allowsCustomValue
      menuTrigger="focus"
      isDisabled={disabled}
      isRequired={required}
      validationBehavior="native"
      validate={() => (required && !value.trim() ? "Enter a value." : null)}
      inputValue={value}
      selectedKey={null}
      onInputChange={onValueChange}
      onSelectionChange={(key) => {
        if (key !== null) onValueChange(String(key));
      }}
      allowsEmptyCollection
    >
      <div className="autocomplete-input-row">
        <Input id={id} maxLength={maxLength} placeholder={placeholder} />
        <Button type="button" aria-label={`Show ${ariaLabel} suggestions`}>
          ⌄
        </Button>
      </div>
      <Popover className="autocomplete-popover" isNonModal>
        <ListBox
          items={visibleOptions.map((option) => ({ id: option, option }))}
          renderEmptyState={() => "No matching suggestions"}
        >
          {(item) => (
            <ListBoxItem textValue={item.option}>{item.option}</ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
};

export const AutocompleteMultiSelect = ({
  options,
  value,
  onChange,
  disabled,
  "aria-label": label,
}: {
  options: readonly AutocompleteOption[];
  value: readonly string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  "aria-label": string;
}) => {
  const [query, setQuery] = useState("");
  const available = options.filter(
    (option) =>
      !value.includes(option.value) &&
      option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <ComboBox
      className="folio-autocomplete autocomplete-multiple"
      aria-label={label}
      menuTrigger="focus"
      isDisabled={disabled}
      inputValue={query}
      selectedKey={null}
      onInputChange={setQuery}
      onSelectionChange={(key) => {
        if (key === null) return;
        const selected = String(key);
        if (
          !options.some(
            (option) => option.value === selected && !option.disabled,
          ) ||
          value.includes(selected)
        )
          return;
        onChange([...value, selected]);
        setQuery("");
      }}
      allowsEmptyCollection
    >
      <Group
        className="autocomplete-multiple-control"
        aria-label={`Selected ${label} and available options`}
      >
        <div className="autocomplete-chips" aria-label={`Selected ${label}`}>
          {value.map((selected) => {
            const option = options.find((option) => option.value === selected);
            return (
              <span className="autocomplete-chip" key={selected}>
                {option?.label ?? selected}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${option?.label ?? selected}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(value.filter((item) => item !== selected));
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
        <div className="autocomplete-input-row">
          <Input placeholder="Search and select…" />
          <Button type="button" aria-label={`Show ${label} options`}>
            ⌄
          </Button>
        </div>
      </Group>
      <Popover className="autocomplete-popover" isNonModal>
        <ListBox
          items={available.map((option) => ({ ...option, id: option.value }))}
          disabledKeys={options
            .filter((option) => option.disabled)
            .map((option) => option.value)}
          renderEmptyState={() => "No matching options"}
        >
          {(option) => (
            <ListBoxItem textValue={option.label}>{option.label}</ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
};
