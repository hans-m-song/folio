import { useRouterState } from "@tanstack/react-router";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import type { User } from "../domain/types";
import { hasPermission, permissions } from "../server/authorization";

const bankingLinks = [
  { href: "/banking/activity", label: "Activity" },
  { href: "/banking/reconcile", label: "Reconcile" },
  { href: "/banking/imports", label: "Import history" },
] as const;

const routeIsActive = (pathname: string, href: string): boolean =>
  href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

const routeCurrentState = (
  pathname: string,
  href: string,
): "page" | "location" | undefined =>
  pathname === href
    ? "page"
    : routeIsActive(pathname, href)
      ? "location"
      : undefined;

const PrimaryNavigation = ({
  pathname,
  userRole,
  onNavigate,
  id,
}: {
  pathname: string;
  userRole: User["role"];
  onNavigate?: () => void;
  id?: string;
}) => {
  const bankingActive = pathname.startsWith("/banking");
  const canAdministerUsers = hasPermission(userRole, permissions.userAdmin);

  return (
    <nav id={id} aria-label="Primary navigation" onClick={onNavigate}>
      <ul className="app-nav-list">
        <li>
          <a
            className="app-nav-link"
            href="/"
            aria-current={routeCurrentState(pathname, "/")}
            data-active={routeIsActive(pathname, "/") || undefined}
          >
            Overview
          </a>
        </li>
        <li>
          <a
            className="app-nav-link"
            href="/transactions"
            aria-current={routeCurrentState(pathname, "/transactions")}
            data-active={routeIsActive(pathname, "/transactions") || undefined}
          >
            Transactions
          </a>
        </li>
        <li className="app-nav-group">
          <a
            className="app-nav-link"
            href="/banking/activity"
            aria-current={bankingActive ? "location" : undefined}
            data-active={bankingActive || undefined}
          >
            Banking
          </a>
          <ul className="app-nav-children">
            {bankingLinks.map(({ href, label }) => (
              <li key={href}>
                <a
                  className="app-nav-link app-nav-link--child"
                  href={href}
                  aria-current={routeCurrentState(pathname, href)}
                  data-active={routeIsActive(pathname, href) || undefined}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </li>
        <li>
          <a
            className="app-nav-link"
            href="/imports"
            aria-current={routeCurrentState(pathname, "/imports")}
            data-active={routeIsActive(pathname, "/imports") || undefined}
          >
            Sources
          </a>
        </li>
        <li>
          <a
            className="app-nav-link"
            href="/reports"
            aria-current={routeCurrentState(pathname, "/reports")}
            data-active={routeIsActive(pathname, "/reports") || undefined}
          >
            Reports
          </a>
        </li>
        {canAdministerUsers && (
          <li>
            <a
              className="app-nav-link"
              href="/admin/users"
              aria-current={routeCurrentState(pathname, "/admin/users")}
              data-active={routeIsActive(pathname, "/admin/users") || undefined}
            >
              Administration
            </a>
          </li>
        )}
      </ul>
    </nav>
  );
};

export const AppShell = ({
  children,
  userRole,
}: {
  children: ReactNode;
  userRole: User["role"];
}) => {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const addMenu = useRef<HTMLDetailsElement>(null);
  const mobileNavigation = useRef<HTMLDetailsElement>(null);

  const closeAddMenu = () => {
    if (addMenu.current) addMenu.current.open = false;
  };

  const closeMobileNavigation = () => {
    if (mobileNavigation.current) mobileNavigation.current.open = false;
  };

  const handleMobileNavigationKeyDown = (
    event: KeyboardEvent<HTMLDetailsElement>,
  ) => {
    if (event.key !== "Escape" || !mobileNavigation.current?.open) return;

    event.preventDefault();
    closeMobileNavigation();
    mobileNavigation.current.querySelector("summary")?.focus();
  };

  return (
    <div className="app-shell">
      <a className="app-skip-link" href="#folio-main">
        Skip to content
      </a>
      <header className="app-header">
        <a className="app-brand" href="/" aria-label="Folio overview">
          <span className="app-brand__mark" aria-hidden="true">
            F
          </span>
          <span>Folio</span>
        </a>
        <span className="app-header__descriptor">
          Private preparation workspace
        </span>
        <div className="app-header__actions">
          <details className="app-add" ref={addMenu}>
            <summary aria-label="Add a transaction or import">
              <span className="app-add__plus" aria-hidden="true">
                +
              </span>
              Add
            </summary>
            <div className="app-add__panel">
              <a href="/transactions/new" onClick={closeAddMenu}>
                Manual transaction
              </a>
              <a href="/imports/stripe" onClick={closeAddMenu}>
                Import Stripe CSV
              </a>
              <a href="/imports/commbank" onClick={closeAddMenu}>
                Import CommBank CSV
              </a>
              <a href="/imports/pdf" onClick={closeAddMenu}>
                Upload PDF evidence
              </a>
            </div>
          </details>
          <form method="post" action="/auth/logout">
            <button className="app-sign-out" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="app-layout">
        <aside className="app-sidebar">
          <PrimaryNavigation pathname={pathname} userRole={userRole} />
          <details
            className="app-mobile-nav"
            ref={mobileNavigation}
            onKeyDown={handleMobileNavigationKeyDown}
          >
            <summary aria-controls="folio-mobile-navigation">Menu</summary>
            <div className="app-mobile-nav__panel">
              <PrimaryNavigation
                id="folio-mobile-navigation"
                pathname={pathname}
                userRole={userRole}
                onNavigate={closeMobileNavigation}
              />
            </div>
          </details>
        </aside>
        <div className="app-content" id="folio-main" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
};
