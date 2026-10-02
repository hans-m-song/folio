interface MoneyTextProps {
  children: string | null | undefined;
  as?: "span" | "strong" | "small";
  className?: string;
}

export const MoneyText = ({
  children,
  as: Element = "span",
  className,
}: MoneyTextProps) => (
  <Element
    className={["money-text", className].filter(Boolean).join(" ")}
    data-money-value=""
  >
    {children}
  </Element>
);
