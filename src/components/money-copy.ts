const moneyValueSelector = "[data-money-value]";

const elementForNode = (node: Node | null): Element | null => {
  if (!node) return null;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
};

const isEditableNode = (node: Node | null): boolean => {
  let element = elementForNode(node);

  while (element) {
    if (element.matches("input, textarea")) return true;

    const contentEditable = element.getAttribute("contenteditable");
    if (contentEditable !== null) {
      const normalizedValue = contentEditable.toLowerCase();
      if (normalizedValue === "false") return false;
      if (
        normalizedValue === "" ||
        normalizedValue === "true" ||
        normalizedValue === "plaintext-only"
      )
        return true;
    }

    element = element.parentElement;
  }

  return false;
};

const moneyValueForNode = (node: Node): Element | null =>
  elementForNode(node)?.closest(moneyValueSelector) ?? null;

export const handleMoneyCopy = (event: ClipboardEvent): void => {
  if (typeof document === "undefined" || event.defaultPrevented) return;
  if (isEditableNode(event.target as Node | null)) return;
  if (isEditableNode(document.activeElement)) return;

  const clipboardData = event.clipboardData;
  if (!clipboardData || typeof clipboardData.setData !== "function") return;

  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;

  const range = selection.getRangeAt(0);
  if (
    isEditableNode(selection.anchorNode) ||
    isEditableNode(selection.focusNode)
  )
    return;

  const startValue = moneyValueForNode(range.startContainer);
  if (!startValue || startValue !== moneyValueForNode(range.endContainer))
    return;
  if (startValue.querySelector(moneyValueSelector)) return;

  const selectedText = selection.toString();
  if (!selectedText.includes(",")) return;

  try {
    clipboardData.setData("text/plain", selectedText.replaceAll(",", ""));
  } catch {
    return;
  }

  event.preventDefault();
};

export const listenForMoneyCopy = (): (() => void) => {
  if (typeof document === "undefined") return () => {};

  document.addEventListener("copy", handleMoneyCopy);
  return () => document.removeEventListener("copy", handleMoneyCopy);
};
