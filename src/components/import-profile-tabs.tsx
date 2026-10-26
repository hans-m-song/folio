import "../styles/import-profile-tabs.css";

const profiles = [
  { id: "upload", label: "Upload file", href: "/imports/upload" },
  { id: "library", label: "File library", href: "/imports/library" },
] as const;

export type SourceTab =
  | (typeof profiles)[number]["id"]
  | "stripe"
  | "commbank"
  | "pdf";

export const SourceTabs = ({ active }: { active?: SourceTab }) => {
  const activeTab = active === "library" ? "library" : "upload";

  return (
    <nav className="import-profile-tabs" aria-label="Sources">
      {profiles.map((profile) => (
        <a
          key={profile.id}
          href={profile.href}
          aria-current={activeTab === profile.id ? "page" : undefined}
        >
          {profile.label}
        </a>
      ))}
    </nav>
  );
};
