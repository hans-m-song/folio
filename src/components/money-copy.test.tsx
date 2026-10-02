// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listenForMoneyCopy } from "./money-copy";

const makeClipboardData = () => ({ setData: vi.fn() });

const dispatchCopy = (
  target: EventTarget,
  clipboardData: ReturnType<
    typeof makeClipboardData
  > | null = makeClipboardData(),
): ClipboardEvent => {
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  target.dispatchEvent(event);
  return event as ClipboardEvent;
};

const makeMoneyValue = (text: string): HTMLSpanElement => {
  const value = document.createElement("span");
  value.setAttribute("data-money-value", "");
  value.textContent = text;
  document.body.append(value);
  return value;
};

const selectText = (
  textNode: Text,
  startOffset: number,
  endOffset: number,
): void => {
  const range = document.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

describe("single-money-value copy", () => {
  let stopListening: () => void;

  beforeEach(() => {
    document.body.replaceChildren();
    stopListening = listenForMoneyCopy();
  });

  afterEach(() => {
    stopListening();
    vi.restoreAllMocks();
    document.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
  });

  it("removes grouping commas from a partial selection only", () => {
    const value = makeMoneyValue("AUD 1,234.5000");
    const text = value.firstChild as Text;
    selectText(text, 4, 9);
    const clipboardData = makeClipboardData();

    const event = dispatchCopy(document.body, clipboardData);

    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "1234");
    expect(event.defaultPrevented).toBe(true);
  });

  it("preserves currency, sign, and decimal places in a full-value selection", () => {
    const value = makeMoneyValue("AUD -1,234.5000");
    const text = value.firstChild as Text;
    selectText(text, 0, text.length);
    const clipboardData = makeClipboardData();

    const event = dispatchCopy(document.body, clipboardData);

    expect(clipboardData.setData).toHaveBeenCalledWith(
      "text/plain",
      "AUD -1234.5000",
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves selections with surrounding prose or multiple money values native", () => {
    const paragraph = document.createElement("p");
    const prefix = document.createTextNode("Total: ");
    const first = document.createElement("span");
    first.dataset.moneyValue = "";
    first.textContent = "AUD 1,234.00";
    const separator = document.createTextNode(" and ");
    const second = document.createElement("span");
    second.dataset.moneyValue = "";
    second.textContent = "AUD 5,678.00";
    paragraph.append(prefix, first, separator, second);
    document.body.append(paragraph);

    const proseRange = document.createRange();
    proseRange.setStart(prefix, 0);
    proseRange.setEnd(first.firstChild!, first.textContent!.length);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(proseRange);
    const proseClipboard = makeClipboardData();

    const proseEvent = dispatchCopy(document.body, proseClipboard);

    expect(proseClipboard.setData).not.toHaveBeenCalled();
    expect(proseEvent.defaultPrevented).toBe(false);

    const multiValueRange = document.createRange();
    multiValueRange.setStart(first.firstChild!, 0);
    multiValueRange.setEnd(second.firstChild!, second.textContent!.length);
    selection.removeAllRanges();
    selection.addRange(multiValueRange);
    const multiValueClipboard = makeClipboardData();

    const multiValueEvent = dispatchCopy(document.body, multiValueClipboard);

    expect(multiValueClipboard.setData).not.toHaveBeenCalled();
    expect(multiValueEvent.defaultPrevented).toBe(false);
  });

  it("leaves selections spanning nested money markers native", () => {
    const outer = makeMoneyValue("");
    const prefix = document.createTextNode("Total: ");
    const nested = document.createElement("span");
    nested.dataset.moneyValue = "";
    nested.textContent = "AUD 1,234.00";
    const suffix = document.createTextNode(" including fee");
    outer.append(prefix, nested, suffix);
    const range = document.createRange();
    range.setStart(prefix, 0);
    range.setEnd(suffix, suffix.length);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboardData = makeClipboardData();

    const event = dispatchCopy(document.body, clipboardData);

    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves collapsed, absent, and multiple-range selections native", () => {
    const value = makeMoneyValue("AUD 1,234.00");
    const text = value.firstChild as Text;
    selectText(text, 0, 0);
    const collapsedClipboard = makeClipboardData();
    const collapsedEvent = dispatchCopy(document.body, collapsedClipboard);
    expect(collapsedClipboard.setData).not.toHaveBeenCalled();
    expect(collapsedEvent.defaultPrevented).toBe(false);

    const getSelection = vi.spyOn(document, "getSelection");
    getSelection.mockReturnValue(null);
    const absentClipboard = makeClipboardData();
    const absentEvent = dispatchCopy(document.body, absentClipboard);
    expect(absentClipboard.setData).not.toHaveBeenCalled();
    expect(absentEvent.defaultPrevented).toBe(false);

    getSelection.mockReturnValue({
      isCollapsed: false,
      rangeCount: 2,
    } as unknown as Selection);
    const multipleClipboard = makeClipboardData();
    const multipleEvent = dispatchCopy(document.body, multipleClipboard);
    expect(multipleClipboard.setData).not.toHaveBeenCalled();
    expect(multipleEvent.defaultPrevented).toBe(false);
  });

  it.each(["input", "textarea"])("leaves %s copying native", (tagName) => {
    const control = document.createElement(tagName);
    document.body.append(control);
    const clipboardData = makeClipboardData();

    const event = dispatchCopy(control, clipboardData);

    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves contenteditable selections native", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const value = document.createElement("span");
    value.dataset.moneyValue = "";
    value.textContent = "AUD 1,234.00";
    editable.append(value);
    document.body.append(editable);
    selectText(value.firstChild as Text, 0, value.textContent!.length);
    const clipboardData = makeClipboardData();

    const event = dispatchCopy(document.body, clipboardData);

    expect(clipboardData.setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the native fallback for unchanged, handled, missing, or unwritable data", () => {
    const plainValue = makeMoneyValue("AUD 100.00");
    const plainText = plainValue.firstChild as Text;
    selectText(plainText, 0, plainText.length);
    const unchangedClipboard = makeClipboardData();
    const unchangedEvent = dispatchCopy(document.body, unchangedClipboard);
    expect(unchangedClipboard.setData).not.toHaveBeenCalled();
    expect(unchangedEvent.defaultPrevented).toBe(false);

    const groupedValue = makeMoneyValue("AUD 1,234.00");
    const groupedText = groupedValue.firstChild as Text;
    selectText(groupedText, 0, groupedText.length);

    const handledEvent = new Event("copy", { bubbles: true, cancelable: true });
    handledEvent.preventDefault();
    Object.defineProperty(handledEvent, "clipboardData", {
      value: makeClipboardData(),
    });
    document.body.dispatchEvent(handledEvent);
    expect(
      (handledEvent as ClipboardEvent).clipboardData?.setData,
    ).not.toHaveBeenCalled();

    const missingEvent = dispatchCopy(document.body, null);
    expect(missingEvent.defaultPrevented).toBe(false);

    const unwritableClipboard = makeClipboardData();
    unwritableClipboard.setData.mockImplementation(() => {
      throw new Error("Clipboard data is not writable");
    });
    const unwritableEvent = dispatchCopy(document.body, unwritableClipboard);
    expect(unwritableEvent.defaultPrevented).toBe(false);
  });

  it("does not handle cut events", () => {
    const value = makeMoneyValue("AUD 1,234.00");
    const text = value.firstChild as Text;
    selectText(text, 0, text.length);
    const event = new Event("cut", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
