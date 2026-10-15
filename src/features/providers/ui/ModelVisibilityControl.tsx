import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Search } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import {
  getPickerVisibilitySnapshot,
  loadHiddenPickerModels,
  savePickerModelsVisible,
  subscribePickerVisibility,
  type AgentModel,
} from "../../sessions/model/models";
import {
  loadProjectProviderSettings,
  projectProvidersRevision,
  setProjectModelsHidden,
  subscribeProjectProviders,
} from "../../sessions/model/projectProviders";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";

/** A provider's full catalog stays available here so hidden models can be restored. */
export function ModelVisibilityControl({
  harness,
  models,
  project,
}: {
  harness: HarnessId;
  models: AgentModel[];
  project?: string;
}) {
  useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  useSyncExternalStore(
    subscribeProjectProviders,
    projectProvidersRevision,
    projectProvidersRevision,
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const globalHidden = new Set(loadHiddenPickerModels());
  const projectHidden = new Set(
    loadProjectProviderSettings(project).hiddenModels ?? [],
  );
  const visible = (model: AgentModel) =>
    !globalHidden.has(model.id) && !projectHidden.has(model.id);
  const count = models.filter(visible).length;
  const needle = query.trim().toLowerCase();
  const matches = models.filter((model) =>
    `${model.name} ${model.provider?.name ?? ""} ${model.provider?.id ?? ""}`
      .toLowerCase()
      .includes(needle),
  );
  const change = (ids: string[], show: boolean) => {
    if (project) setProjectModelsHidden(project, ids, !show);
    else savePickerModelsVisible(ids, show);
  };
  const focusRow = (delta: number, from?: EventTarget) => {
    const rows = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemcheckbox"]:not(:disabled)',
      ) ?? [],
    );
    if (!rows.length) return;
    const index = rows.indexOf(from as HTMLButtonElement);
    rows[(index + delta + rows.length) % rows.length]?.focus();
  };

  return (
    <>
      <SecondaryButton
        ref={trigger}
        aria-label={`Choose visible ${HARNESS_TITLE[harness]} models`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={!models.length}
        title="Choose which models appear in the picker"
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
      >
        Models{" "}
        <span className="tabular-nums text-content/60">
          {count}/{models.length}
        </span>
        <ChevronDown className="size-3" />
      </SecondaryButton>
      {open && (
        <Popover
          anchor={trigger}
          id={id}
          role="dialog"
          aria-label={`${HARNESS_TITLE[harness]} model visibility`}
          side="bottom"
          align="end"
          width={340}
          maxHeight={420}
          ignore={`[aria-controls="${id}"]`}
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") trigger.current?.focus();
          }}
          className="flex flex-col"
        >
          <div className="px-3 pt-3 pb-2">
            <h3 className="text-[13px] font-medium text-content">
              {HARNESS_TITLE[harness]} models
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-content/70">
              Choose models to show in the picker.
            </p>
            <label className="mt-3 flex items-center gap-2 rounded-md border border-content/15 px-2 py-1.5 focus-within:border-accent">
              <Search className="size-3.5 shrink-0 text-content/70" />
              <input
                autoFocus
                aria-label={`Search ${HARNESS_TITLE[harness]} models`}
                placeholder="Search models"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/65"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusRow(1);
                  }
                }}
              />
            </label>
          </div>
          <div
            ref={menu}
            role="menu"
            aria-label="Model visibility"
            className="min-h-0 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusRow(event.key === "ArrowDown" ? 1 : -1, event.target);
              }
            }}
          >
            {matches.map((model) => {
              const locked = project != null && globalHidden.has(model.id);
              return (
                <button
                  key={model.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={visible(model)}
                  disabled={locked}
                  onClick={() => change([model.id], !visible(model))}
                  className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[12px] text-content hover:bg-content/8 focus-visible:bg-content/8 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className={`grid size-4 shrink-0 place-items-center rounded border ${visible(model) ? "border-accent bg-accent text-white" : "border-content/30"}`}
                  >
                    {visible(model) && (
                      <Check className="size-3" strokeWidth={2.5} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{model.name}</span>
                    {(locked || model.provider) && (
                      <span className="mt-0.5 block text-[11px] text-content/70">
                        {locked ? "Hidden globally" : model.provider?.name}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {!matches.length && (
              <p className="px-2 py-5 text-center text-[12px] text-content/70">
                No matching models.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-content/10 px-3 py-2 text-[12px]">
            <span className="text-content/70">
              {count} of {models.length} shown
            </span>
            <button
              type="button"
              onClick={() =>
                change(
                  models.map((model) => model.id),
                  true,
                )
              }
              className="rounded px-1 py-0.5 font-medium text-content hover:bg-content/8 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Show all
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}
