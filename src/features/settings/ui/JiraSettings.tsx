import { useCallback, useEffect, useId, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { clearInboxCache } from "../../inbox/model/githubTasks";
import {
  disconnectJira,
  JIRA_CHANGE_EVENT,
  jiraConnected,
  listJiraProjects,
  loadHiddenJiraProjectIds,
  loadJiraInboxFilter,
  notifyJiraChange,
  saveHiddenJiraProjectIds,
  saveJiraConfig,
  saveJiraInboxFilter,
  validateJiraJql,
  type JiraProject,
  type JiraStatus,
} from "../../inbox/model/jira";

export function JiraSettings() {
  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [site, setSite] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [hiddenIds, setHiddenIds] = useState(loadHiddenJiraProjectIds);
  const [inboxFilter, setInboxFilter] = useState(loadJiraInboxFilter);
  const [mode, setMode] = useState(inboxFilter.mode);
  const [jql, setJql] = useState(inboxFilter.jql);
  const [applying, setApplying] = useState(false);
  const [jqlError, setJqlError] = useState<string | null>(null);
  const filterId = useId();

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await listJiraProjects());
    } catch (err) {
      setProjects([]);
      setError(String(err instanceof Error ? err.message : err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void jiraConnected()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(String(err instanceof Error ? err.message : err));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    const onChange = () => {
      setHiddenIds(loadHiddenJiraProjectIds());
      const next = loadJiraInboxFilter();
      setInboxFilter((previous) =>
        previous.mode === next.mode && previous.jql === next.jql
          ? previous
          : next,
      );
    };
    window.addEventListener(JIRA_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(JIRA_CHANGE_EVENT, onChange);
    };
  }, []);

  useEffect(() => {
    setMode(inboxFilter.mode);
    setJql(inboxFilter.jql);
  }, [inboxFilter]);

  useEffect(() => {
    if (status?.connected && mode === "project") void loadProjects();
  }, [status?.connected, mode, loadProjects]);

  const selectProjectMode = () => {
    setJqlError(null);
    try {
      clearInboxCache();
      saveJiraInboxFilter({ ...inboxFilter, mode: "project" });
      setMode("project");
    } catch {
      setJqlError("Could not save the Jira filter. Try again.");
    }
  };

  const applyJql = async () => {
    if (applying || busy || !jql.trim()) return;
    setApplying(true);
    setJqlError(null);
    try {
      await validateJiraJql(jql);
      clearInboxCache();
      saveJiraInboxFilter({ mode: "jql", jql });
    } catch (err) {
      setJqlError(String(err instanceof Error ? err.message : err));
    } finally {
      setApplying(false);
    }
  };

  const connect = async () => {
    if (busy || checking || !site.trim() || !email.trim() || !token.trim())
      return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await saveJiraConfig({ site, email, token }));
      setToken("");
      clearInboxCache();
      saveHiddenJiraProjectIds([]);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await disconnectJira());
      setProjects([]);
      setToken("");
      clearInboxCache();
      notifyJiraChange();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3.5">
      {checking ? (
        <p className="text-[12px] text-content/45">Checking Jira connection…</p>
      ) : status?.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[12px] text-content/65">
            <p className="break-all">{status.site}</p>
            <p className="flex min-w-0">
              <PrivateEmail key={status.email} email={status.email} />
            </p>
          </div>
          <SecondaryButton
            onClick={() => void disconnect()}
            disabled={busy || applying}
          >
            {busy ? "Disconnecting" : "Disconnect"}
          </SecondaryButton>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-[12px] leading-relaxed text-content/45">
            Connect your Jira Cloud site using your Atlassian email and an API
            token without scopes. Disconnect deletes the saved credentials.
          </p>
          {(
            [
              {
                label: "Jira site",
                value: site,
                set: setSite,
                type: "text",
                placeholder: "yourteam.atlassian.net",
              },
              {
                label: "Atlassian email",
                value: email,
                set: setEmail,
                type: "email",
                placeholder: "you@example.com",
              },
              {
                label: "Jira API token",
                value: token,
                set: setToken,
                type: "password",
                placeholder: "API token",
              },
            ] as const
          ).map((field) => (
            <label
              key={field.label}
              className="flex flex-col gap-1 text-[12px] text-content/65"
            >
              {field.label}
              <input
                aria-label={field.label}
                type={field.type}
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                placeholder={field.placeholder}
                disabled={busy}
                required
                autoComplete="off"
                spellCheck={false}
                className="h-8 w-full rounded-md border border-content/10 bg-transparent px-2 text-content outline-none focus:border-content/20"
              />
            </label>
          ))}
          <div className="flex items-center gap-3">
            <SecondaryButton
              type="submit"
              disabled={busy || !site.trim() || !email.trim() || !token.trim()}
            >
              {busy ? "Connecting" : "Connect"}
            </SecondaryButton>
            <button
              type="button"
              onClick={() =>
                void openUrl(
                  "https://id.atlassian.com/manage-profile/security/api-tokens",
                )
              }
              className="text-[12px] text-content/65 hover:text-content"
            >
              Create API token
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-[12px] text-red-400/90">
          {error}
        </p>
      ) : null}
      {status?.connected ? (
        <div className="mt-4 flex flex-col gap-2">
          <fieldset disabled={busy || applying} className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-content/65">
              Filter tickets by
            </legend>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-content">
                <input
                  type="radio"
                  name={`${filterId}-mode`}
                  checked={mode === "project"}
                  onChange={selectProjectMode}
                />
                Project
              </label>
              <label className="flex items-center gap-2 text-[13px] text-content">
                <input
                  type="radio"
                  name={`${filterId}-mode`}
                  checked={mode === "jql"}
                  onChange={() => {
                    setMode("jql");
                    setJqlError(null);
                  }}
                />
                JQL
              </label>
            </div>
          </fieldset>
          {mode === "jql" ? (
            <form
              className="mt-2 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void applyJql();
              }}
            >
              <label
                htmlFor={`${filterId}-query`}
                className="text-[12px] text-content/65"
              >
                JQL query
              </label>
              <textarea
                id={`${filterId}-query`}
                value={jql}
                onChange={(event) => {
                  setJql(event.target.value);
                  setJqlError(null);
                }}
                placeholder={
                  "project = ENG AND statusCategory != Done ORDER BY updated DESC"
                }
                rows={4}
                disabled={busy || applying}
                required
                spellCheck={false}
                aria-describedby={`${filterId}-help${jqlError ? ` ${filterId}-error` : ""}`}
                aria-invalid={jqlError ? true : undefined}
                className="w-full resize-y rounded-md border border-content/10 bg-transparent px-2 py-1.5 font-mono text-[12px] text-content outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
              />
              <p
                id={`${filterId}-help`}
                className="text-[12px] leading-relaxed text-content/65"
              >
                JQL controls which tickets are fetched. Project selections and
                Assigned to me do not apply. Inbox status, time, and search
                filters still narrow the results.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <SecondaryButton
                  type="submit"
                  disabled={
                    busy ||
                    applying ||
                    !jql.trim() ||
                    (inboxFilter.mode === "jql" &&
                      inboxFilter.jql === jql.trim())
                  }
                >
                  {applying ? "Checking JQL…" : "Apply JQL"}
                </SecondaryButton>
                <p role="status" className="text-[12px] text-content/65">
                  {inboxFilter.mode === "jql" && inboxFilter.jql === jql.trim()
                    ? "JQL query applied."
                    : "Apply to check and save your query."}
                </p>
              </div>
            </form>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-content">
                  Projects
                </span>
                <SecondaryButton
                  disabled={busy || checking}
                  onClick={() => void loadProjects()}
                >
                  Refresh projects
                </SecondaryButton>
              </div>
              <p className="text-[12px] text-content/45">
                Unchecked projects stay out of the inbox.
              </p>
              {projects.map((project) => (
                <label
                  key={project.id}
                  className="flex items-center gap-2 text-[13px] text-content"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenIds.includes(project.id)}
                    disabled={busy}
                    onChange={() => {
                      const next = hiddenIds.includes(project.id)
                        ? hiddenIds.filter((id) => id !== project.id)
                        : [...hiddenIds, project.id];
                      clearInboxCache();
                      saveHiddenJiraProjectIds(next);
                    }}
                  />
                  {project.name}{" "}
                  <span className="text-content/40">{project.key}</span>
                </label>
              ))}
            </>
          )}
          {jqlError ? (
            <p
              id={`${filterId}-error`}
              role="alert"
              className="text-[12px] text-red-600 dark:text-red-400/90"
            >
              {jqlError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
