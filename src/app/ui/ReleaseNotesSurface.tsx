import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import type { ReleaseNotesTabSource } from "../model/releaseNotes";
import { useReleaseNotes } from "../hooks/useReleaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";

export function ReleaseNotesSurface({
  source,
  visible = true,
}: {
  source: ReleaseNotesTabSource;
  visible?: boolean;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const { notes, error, retry } = useReleaseNotes(source.version, visible);
  const markdown = notes?.markdown;

  return (
    <div
      ref={lockOverscroll}
      className="h-full overflow-y-auto overscroll-none"
    >
      <article
        aria-label="Release notes"
        className="mx-auto w-full max-w-3xl px-8 py-10"
      >
        {markdown ? (
          <AgentMarkdown text={markdown} streaming={false} />
        ) : error ? (
          <p role="alert" className="text-[13px] text-content/60">
            Could not load release notes. <button onClick={retry}>Retry</button>
          </p>
        ) : notes === undefined ? (
          <p role="status" className="text-[13px] text-content/60">
            Loading release notes…
          </p>
        ) : (
          <p className="text-[13px] text-content/60">
            Release notes for this version are not available in this build.
          </p>
        )}
      </article>
    </div>
  );
}
