import "../styles/import-profile-tabs.css";

const profiles = [
  { id: "stripe", label: "Stripe CSV", href: "/imports/stripe" },
  { id: "commbank", label: "CommBank CSV", href: "/imports/commbank" },
  { id: "pdf", label: "PDF evidence", href: "/imports/pdf" },
  { id: "library", label: "File library", href: "/imports/library" },
] as const;

export type SourceTab = (typeof profiles)[number]["id"];

export const SourceTabs = ({ active }: { active?: SourceTab }) => (
  <nav className="import-profile-tabs" aria-label="Sources">
    {profiles.map((profile) => (
      <a
        key={profile.id}
        href={profile.href}
        aria-current={active === profile.id ? "page" : undefined}
      >
        {profile.label}
      </a>
    ))}
  </nav>
);
