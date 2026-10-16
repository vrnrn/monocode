import { createRoot } from "react-dom/client";
import { UsageProviderChip } from "../../src/app/shell/UsageProviderChip";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light"
    ? "light"
    : "dark",
);
createRoot(document.getElementById("root")!).render(
  <div className="flex h-screen items-end bg-background-base p-6">
    <UsageProviderChip
      limits={{
        provider: "claude",
        authProvider: "bedrock",
        status: "ok",
        error: null,
        session: null,
        weekly: null,
        monthly: null,
        resetCredits: null,
        updatedAt: Date.now(),
      }}
      now={Date.now()}
      onReconnect={async () => {
        throw new Error("Bedrock must not request Claude sign-in");
      }}
    />
  </div>,
);
