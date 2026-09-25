import {
  ClientOnly,
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";

import { getCurrentSession } from "../auth/session-server";
import { AppShell } from "../components/app-shell";
import { sanitizeClientRenderFailure } from "../domain/diagnostics";
import appCss from "../styles/app.css?url";
import { privateGate, reportClientRenderFailure } from "../server/operations";

const DevelopmentFormDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("../components/devtools").then(({ Devtools: FormDevtools }) => ({
        default: FormDevtools,
      })),
    )
  : null;

export const Route = createRootRoute({
  beforeLoad: () => privateGate(),
  loader: () => getCurrentSession(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { httpEquiv: "cache-control", content: "no-store" },
      { title: "Folio · Private transaction archive" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  notFoundComponent: FolioNotFoundBoundary,
  errorComponent: FolioErrorBoundary,
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootLayout() {
  const session = Route.useLoaderData();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (
    !session.authenticated ||
    pathname.startsWith("/auth/") ||
    pathname === "/health"
  )
    return <Outlet />;

  return (
    <AppShell userRole={session.user.role}>
      <Outlet />
    </AppShell>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {DevelopmentFormDevtools && (
          <ClientOnly>
            <Suspense fallback={null}>
              <DevelopmentFormDevtools />
            </Suspense>
          </ClientOnly>
        )}
        <Scripts />
      </body>
    </html>
  );
}

function FolioNotFoundBoundary() {
  return (
    <main className="boundary-page">
      <p className="eyebrow">Private preparation workspace</p>
      <h1>Page not found</h1>
      <p>The requested Folio page does not exist.</p>
      <a href="/">Return to Folio</a>
    </main>
  );
}

function FolioErrorBoundary({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const lastReportedError = useRef<unknown>(null);

  useEffect(() => {
    if (lastReportedError.current === error) return;
    lastReportedError.current = error;
    void reportClientRenderFailure({
      data: sanitizeClientRenderFailure(error),
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="boundary-page">
      <p className="eyebrow">Private preparation workspace</p>
      <h1>Folio is unavailable</h1>
      <p>Folio could not load this page. Try again or reload the page.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>{" "}
      <button type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
      <a href="/">Return to Folio</a>
    </main>
  );
}
