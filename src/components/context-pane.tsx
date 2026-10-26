import { useBlocker, useRouter, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { createPortal } from "react-dom";

import { ConfirmationDialog } from "./confirmation-dialog";
import "../styles/context-pane.css";

export const maximumContextPaneDepth = 6;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const filePath = new RegExp(`^/imports/files/${uuid}$`, "i");
const transactionPath = new RegExp(`^/transactions/${uuid}(?:/edit)?$`, "i");
const uuidPattern = new RegExp(`^${uuid}$`, "i");
const uploadProfiles = new Set([
  "manual_invoice_pdf_v1",
  "stripe_balance_itemised_csv_v1",
  "commbank_transaction_history_csv_v1",
]);

export const canonicalPaneTarget = (href: unknown): string | null => {
  if (typeof href !== "string" || href.length > 256 || !href.startsWith("/"))
    return null;
  if (href.startsWith("//") || href.includes("\\")) return null;
  const url = new URL(href, "http://folio.invalid");
  if (url.origin !== "http://folio.invalid" || url.hash) return null;
  if (href.split("?")[0] !== url.pathname) return null;
  const entries = [...url.searchParams];
  if (filePath.test(url.pathname) && entries.length === 0) return url.pathname;
  if (transactionPath.test(url.pathname)) {
    if (entries.length === 0) return url.pathname;
    if (
      url.pathname.endsWith("/edit") &&
      entries.length === 1 &&
      entries[0][0] === "bank" &&
      uuidPattern.test(entries[0][1])
    )
      return `${url.pathname}?bank=${entries[0][1]}`;
    return null;
  }
  if (url.pathname === "/transactions/new") {
    if (entries.length === 0) return url.pathname;
    if (
      entries.length === 1 &&
      entries[0][0] === "artifactId" &&
      uuidPattern.test(entries[0][1])
    )
      return `${url.pathname}?artifactId=${entries[0][1]}`;
  }
  if (url.pathname === "/imports/upload") {
    if (entries.length === 0) return url.pathname;
    if (
      entries.length === 1 &&
      entries[0][0] === "profile" &&
      uploadProfiles.has(entries[0][1])
    )
      return `${url.pathname}?profile=${entries[0][1]}`;
  }
  return null;
};

export const parseContextPaneSearch = (search: {
  pane?: unknown;
}): { pane?: string[] } => {
  if (
    !Array.isArray(search.pane) ||
    search.pane.length === 0 ||
    search.pane.length > maximumContextPaneDepth
  )
    return {};
  const pane = search.pane.map(canonicalPaneTarget);
  if (pane.some((target) => target === null)) return {};
  return { pane: pane as string[] };
};

type PaneGuard = { dirty: boolean; pending: boolean };
type GuardEntry = PaneGuard & { scope: string; owner: string | null };
type PaneApi = {
  open: (href: string) => void;
  replace: (href: string) => Promise<void>;
  close: () => void;
  active: boolean;
  clearGuard: () => void;
  refresh: () => void;
};
type PaneContextValue = {
  stack: string[];
  open: (href: string) => void;
  replace: (href: string) => Promise<void>;
  close: () => void;
  setGuard: (id: string, entry: GuardEntry | null) => void;
  clearGuard: (scope: string) => void;
  requestClose: (scope: string, action: () => void) => void;
  confirming: boolean;
  contentRevision: number;
  refresh: () => void;
};
const PaneContext = createContext<PaneContextValue | null>(null);
const PaneScope = createContext<{
  id: string;
  owner: string | null;
  enabled: boolean;
} | null>(null);

export const useContextPane = (): PaneApi | null => {
  const pane = useContext(PaneContext);
  const scope = useContext(PaneScope);
  return useMemo(
    () =>
      pane
        ? {
            open: pane.open,
            replace: pane.replace,
            close: pane.close,
            refresh: pane.refresh,
            active: Boolean(scope?.owner && scope.enabled),
            clearGuard: () => {
              if (scope) pane.clearGuard(scope.id);
            },
          }
        : null,
    [pane, scope],
  );
};

export const usePaneGuard = ({ dirty, pending }: PaneGuard): void => {
  const pane = useContext(PaneContext);
  const scope = useContext(PaneScope);
  const id = useId();
  const setGuard = pane?.setGuard;
  useLayoutEffect(() => {
    if (!scope?.enabled || !setGuard) return;
    setGuard(id, { scope: scope.id, owner: scope.owner, dirty, pending });
    return () => setGuard(id, null);
  }, [id, setGuard, scope, dirty, pending]);
};

export const useContextPaneStack = (): string[] =>
  useContext(PaneContext)?.stack ?? [];

export const useContextPaneRevision = (): number =>
  useContext(PaneContext)?.contentRevision ?? 0;

const ordinaryClick = (event: MouseEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

export const ContextPaneProvider = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const stack = parseContextPaneSearch(location.search).pane ?? [];
  const currentStack = useRef(stack);
  currentStack.current = stack;
  const guards = useRef(new Map<string, GuardEntry>());
  const [contentRevision, setContentRevision] = useState(0);
  const refresh = useCallback(
    () => setContentRevision((revision) => revision + 1),
    [],
  );
  const [guardRevision, setGuardRevision] = useState(0);
  const [confirmation, setConfirmation] = useState<{
    finish: (allow: boolean) => void;
  } | null>(null);
  const confirmationRef = useRef(confirmation);
  confirmationRef.current = confirmation;
  const confirm = useCallback((): Promise<boolean> => {
    confirmationRef.current?.finish(false);
    return new Promise((resolve) => {
      const next = {
        finish: (allow: boolean) => {
          setConfirmation(null);
          resolve(allow);
        },
      };
      confirmationRef.current = next;
      setConfirmation(next);
    });
  }, []);
  const setGuard = useCallback((id: string, entry: GuardEntry | null) => {
    if (entry) guards.current.set(id, entry);
    else guards.current.delete(id);
    setGuardRevision((value) => value + 1);
  }, []);
  const clearGuard = useCallback((scope: string) => {
    for (const [id, entry] of guards.current)
      if (entry.scope === scope || entry.scope.startsWith(`${scope}/`))
        guards.current.delete(id);
    setGuardRevision((value) => value + 1);
  }, []);
  const shouldBlockFn = useCallback(
    async ({
      current,
      next,
    }: {
      current: { pathname: string; search: { pane?: unknown } };
      next: { pathname: string; search: { pane?: unknown } };
    }) => {
      const entries = [...guards.current.values()];
      if (entries.some((entry) => entry.pending)) return true;
      const nextStack = parseContextPaneSearch(next.search).pane ?? [];
      const retained = new Set(
        current.pathname === next.pathname
          ? nextStack.map((target, index) => `${index}:${target}`)
          : [],
      );
      const discarded = entries.filter(
        (entry) => entry.dirty && (!entry.owner || !retained.has(entry.owner)),
      );
      if (discarded.length === 0) return false;
      const allow = await confirm();
      if ([...guards.current.values()].some((entry) => entry.pending))
        return true;
      if (allow) {
        for (const entry of discarded) clearGuard(entry.scope);
      }
      return !allow;
    },
    [clearGuard, confirm],
  );
  const hasGuards = useMemo(
    () =>
      [...guards.current.values()].some(
        (entry) => entry.dirty || entry.pending,
      ),
    [guardRevision],
  );
  useBlocker({ shouldBlockFn, enableBeforeUnload: hasGuards });

  const changeStack = useCallback(
    (update: (previous: string[]) => string[]): Promise<void> =>
      router.navigate({
        to: ".",
        search: (previous) => {
          const next = { ...previous };
          const pane = update(parseContextPaneSearch(previous).pane ?? []);
          if (pane.length) next.pane = pane;
          else delete next.pane;
          return next;
        },
        resetScroll: false,
      }),
    [router],
  );
  const open = useCallback(
    (href: string) => {
      const target = canonicalPaneTarget(href);
      if (
        !target ||
        currentStack.current.at(-1) === target ||
        currentStack.current.length >= maximumContextPaneDepth
      )
        return;
      void changeStack((previous) => {
        if (
          previous.at(-1) === target ||
          previous.length >= maximumContextPaneDepth
        )
          return previous;
        return [...previous, target];
      });
    },
    [changeStack],
  );
  const replace = useCallback(
    (href: string) => {
      const target = canonicalPaneTarget(href);
      if (!target || currentStack.current.at(-1) === target)
        return Promise.resolve();
      return changeStack((previous) =>
        previous.length === 0 ? [target] : [...previous.slice(0, -1), target],
      );
    },
    [changeStack],
  );
  const close = useCallback(() => {
    if (currentStack.current.length)
      void changeStack((previous) => previous.slice(0, -1));
  }, [changeStack]);
  const requestClose = useCallback(
    (scope: string, action: () => void) => {
      const entries = [...guards.current.values()].filter(
        (entry) => entry.scope === scope || entry.scope.startsWith(`${scope}/`),
      );
      if (entries.some((entry) => entry.pending)) return;
      if (!entries.some((entry) => entry.dirty)) {
        action();
        return;
      }
      void confirm().then((allow) => {
        if (!allow) return;
        if (
          [...guards.current.values()].some(
            (entry) =>
              (entry.scope === scope || entry.scope.startsWith(`${scope}/`)) &&
              entry.pending,
          )
        )
          return;
        clearGuard(scope);
        action();
      });
    },
    [clearGuard, confirm],
  );
  const serializedStack = JSON.stringify(stack);
  const value = useMemo(
    () => ({
      stack,
      open,
      replace,
      close,
      setGuard,
      clearGuard,
      requestClose,
      confirming: Boolean(confirmation),
      contentRevision,
      refresh,
    }),
    [
      serializedStack,
      open,
      replace,
      close,
      setGuard,
      clearGuard,
      requestClose,
      Boolean(confirmation),
      contentRevision,
      refresh,
    ],
  );
  const captureLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !ordinaryClick(event)) return;
    const anchor =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self") ||
      anchor.dataset.contextPane === "off"
    )
      return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const href = `${url.pathname}${url.search}${url.hash}`;
    const target = canonicalPaneTarget(href);
    if (!target && !hasGuards) return;
    event.preventDefault();
    event.stopPropagation();
    if (target) open(target);
    else void router.navigate({ href });
  };

  useEffect(() => () => confirmationRef.current?.finish(false), []);

  const confirmationContent = confirmation ? (
    <ConfirmationDialog
      title="Discard unsaved changes?"
      description="Your unsaved changes will be lost."
      confirmLabel="Discard changes"
      onCancel={() => confirmation.finish(false)}
      onConfirm={() => confirmation.finish(true)}
    />
  ) : null;
  const confirmationHost = confirmation
    ? [
        ...document.querySelectorAll(
          ".context-pane-modal:not([inert]) .context-pane-dialog",
        ),
      ].at(-1)
    : null;

  return (
    <PaneContext.Provider value={value}>
      <div className="context-pane-root" onClickCapture={captureLink}>
        {children}
        {confirmationHost
          ? createPortal(confirmationContent, confirmationHost)
          : confirmationContent}
      </div>
    </PaneContext.Provider>
  );
};

export const PaneLink = ({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
  const pane = useContextPane();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          ordinaryClick(event) &&
          pane &&
          canonicalPaneTarget(href) &&
          !props.download &&
          (!props.target || props.target === "_self")
        ) {
          event.preventDefault();
          pane.open(href);
        }
      }}
    />
  );
};

export type SidePaneProps = {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode | ((actions: { requestClose: () => void }) => ReactNode);
  pending?: boolean;
  dirty?: boolean;
  owner?: string;
  onExited?: () => void;
};

const ModalLifecycle = ({ onExited }: { onExited?: () => void }) => {
  const callback = useRef(onExited);
  callback.current = onExited;
  useEffect(() => () => callback.current?.(), []);
  return null;
};

const SidePaneGuard = ({ dirty, pending }: PaneGuard) => {
  usePaneGuard({ dirty, pending });
  return null;
};

export const SidePane = ({
  title,
  isOpen,
  onClose,
  children,
  pending = false,
  dirty = false,
  owner,
  onExited,
}: SidePaneProps) => {
  const pane = useContext(PaneContext);
  const parentScope = useContext(PaneScope);
  const id = useId();
  const scope = useMemo(
    () => ({
      id: `${parentScope?.id ?? "pane"}/${id}`,
      owner: owner ?? parentScope?.owner ?? null,
      enabled: isOpen && (parentScope?.enabled ?? true),
    }),
    [id, owner, parentScope, isOpen],
  );
  const [standaloneConfirm, setStandaloneConfirm] = useState(false);
  const effectiveOpen = isOpen && (parentScope?.enabled ?? true);
  const dismiss = () => {
    if (pending) return;
    if (pane) pane.requestClose(scope.id, onClose);
    else if (dirty) setStandaloneConfirm(true);
    else onClose();
  };
  const lastChildren = useRef<ReactNode>(null);
  if (isOpen)
    lastChildren.current =
      typeof children === "function"
        ? children({ requestClose: dismiss })
        : children;
  return (
    <PaneScope.Provider value={scope}>
      {effectiveOpen && <SidePaneGuard dirty={dirty} pending={pending} />}
      <ModalOverlay
        isOpen={effectiveOpen}
        isDismissable={!pending && !pane?.confirming && !standaloneConfirm}
        isKeyboardDismissDisabled={
          pending || Boolean(pane?.confirming) || standaloneConfirm
        }
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
        className="context-pane-overlay"
        data-nested={
          Boolean(parentScope) || Boolean(owner && !owner.startsWith("0:"))
        }
      >
        {({ isExiting }) => (
          <Modal className="context-pane-modal" inert={isExiting || undefined}>
            <ModalLifecycle onExited={onExited} />
            <Dialog className="context-pane-dialog" aria-label={title}>
              <header className="context-pane-header">
                <Heading slot="title">{title}</Heading>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Close ${title}`}
                  disabled={pending}
                  onClick={dismiss}
                >
                  Close
                </button>
              </header>
              <div className="context-pane-content">{lastChildren.current}</div>
              {standaloneConfirm && (
                <ConfirmationDialog
                  title="Discard unsaved changes?"
                  description="Your unsaved changes will be lost."
                  confirmLabel="Discard changes"
                  onCancel={() => setStandaloneConfirm(false)}
                  onConfirm={() => {
                    setStandaloneConfirm(false);
                    onClose();
                  }}
                />
              )}
            </Dialog>
          </Modal>
        )}
      </ModalOverlay>
    </PaneScope.Provider>
  );
};
