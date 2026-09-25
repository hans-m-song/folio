import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TableActionIconName = "view" | "edit" | "copy" | "review";

interface TableIconActionProps {
  icon: TableActionIconName;
  label: string;
  accessibleLabel: string;
  tooltip: string;
  className: string;
  href?: string;
  onClick?: () => void;
}

export const TableIconAction = ({
  icon,
  label,
  accessibleLabel,
  tooltip,
  className,
  href,
  onClick,
}: TableIconActionProps) => {
  const actionRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [pointerActive, setPointerActive] = useState(false);
  const [focusActive, setFocusActive] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
    placement: "top" | "bottom";
  } | null>(null);
  const tooltipOpen = pointerActive || focusActive;

  const updateTooltipPosition = () => {
    const action = actionRef.current;
    if (!action || typeof window === "undefined") return;

    const bounds = action.getBoundingClientRect();
    const halfTooltipWidth = Math.min(128, (window.innerWidth - 24) / 2);
    const left = Math.min(
      Math.max(bounds.left + bounds.width / 2, halfTooltipWidth + 12),
      window.innerWidth - halfTooltipWidth - 12,
    );
    const placement =
      bounds.bottom + 44 < window.innerHeight ? "bottom" : "top";

    setTooltipPosition({
      left,
      top: placement === "bottom" ? bounds.bottom + 6 : bounds.top - 6,
      placement,
    });
  };

  useEffect(() => {
    if (typeof window === "undefined" || !tooltipOpen) return;

    const closeTooltip = () => {
      setPointerActive(false);
      setFocusActive(false);
    };

    window.addEventListener("scroll", closeTooltip, true);
    window.addEventListener("resize", closeTooltip);
    return () => {
      window.removeEventListener("scroll", closeTooltip, true);
      window.removeEventListener("resize", closeTooltip);
    };
  }, [tooltipOpen]);

  const controlProps = {
    className: `${className} table-icon-action`,
    "aria-label": accessibleLabel,
    "aria-describedby": tooltipOpen ? tooltipId : undefined,
  };

  return (
    <>
      <span
        className="table-action-wrap"
        ref={actionRef}
        onMouseEnter={() => {
          updateTooltipPosition();
          setPointerActive(true);
        }}
        onMouseLeave={() => setPointerActive(false)}
        onFocusCapture={() => {
          updateTooltipPosition();
          setFocusActive(true);
        }}
        onBlurCapture={() => setFocusActive(false)}
      >
        {href ? (
          <a href={href} {...controlProps}>
            <TableActionIcon name={icon} />
            <span className="table-action-label">{label}</span>
          </a>
        ) : (
          <button type="button" onClick={onClick} {...controlProps}>
            <TableActionIcon name={icon} />
            <span className="table-action-label">{label}</span>
          </button>
        )}
      </span>
      {tooltipOpen && tooltipPosition && typeof document !== "undefined"
        ? createPortal(
            <span
              className="table-action-tooltip"
              id={tooltipId}
              role="tooltip"
              data-placement={tooltipPosition.placement}
              style={{
                left: `${tooltipPosition.left}px`,
                top: `${tooltipPosition.top}px`,
              }}
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </>
  );
};

const TableActionIcon = ({ name }: { name: TableActionIconName }) => {
  const icon = {
    view: (
      <>
        <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="2.75" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    review: (
      <>
        <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
        <path d="M13 3v5h5" />
        <path d="m13 3 5 5" />
        <circle cx="16" cy="15" r="3.25" />
        <path d="m18.5 17.5 2 2" />
      </>
    ),
  }[name];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {icon}
    </svg>
  );
};
