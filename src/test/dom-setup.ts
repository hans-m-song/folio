if (typeof window !== "undefined") {
  if (!window.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;
      readonly width: number;
      readonly height: number;

      constructor(type: string, options: PointerEventInit = {}) {
        super(type, options);
        this.pointerId = options.pointerId ?? 0;
        this.pointerType = options.pointerType ?? "mouse";
        this.isPrimary = options.isPrimary ?? true;
        this.width = options.width ?? 1;
        this.height = options.height ?? 1;
      }
    }
    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      value: TestPointerEvent,
    });
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: TestPointerEvent,
    });
  }

  if (!globalThis.CSS)
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });

  if (!HTMLElement.prototype.scrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: function (
        this: HTMLElement,
        options: ScrollToOptions | number,
        top?: number,
      ) {
        this.scrollLeft =
          typeof options === "number"
            ? options
            : (options.left ?? this.scrollLeft);
        this.scrollTop =
          typeof options === "number"
            ? (top ?? this.scrollTop)
            : (options.top ?? this.scrollTop);
      },
    });
}
