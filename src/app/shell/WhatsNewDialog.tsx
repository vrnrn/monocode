import {
  formatReleaseDate,
  presentReleaseNotes,
  releaseNotesTitle,
} from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { Modal } from "../../shared/ui/Modal";
import { useReleaseNotes } from "../hooks/useReleaseNotes";

type Props = {
  version: string;
  onClose: () => void;
};

export function WhatsNewBody({ version }: { version: string }) {
  const { notes: document, error, retry } = useReleaseNotes(version);
  const notes = document
    ? presentReleaseNotes(version, document.markdown)
    : null;
  const title = releaseNotesTitle(version);

  return (
    <article aria-label={title} className="px-5 py-4">
      {notes?.markdown ? (
        <AgentMarkdown
          className="whats-new-md"
          text={notes.markdown}
          streaming={false}
        />
      ) : error ? (
        <p role="alert" className="text-[13px] text-content/60">
          Could not load release notes. <button onClick={retry}>Retry</button>
        </p>
      ) : document === undefined ? (
        <p role="status" className="text-[13px] text-content/60">
          Loading release notes…
        </p>
      ) : (
        <p className="text-[13px] text-content/60">
          Release notes for this version are not available in this build.
        </p>
      )}
    </article>
  );
}

export function WhatsNewDialog({ version, onClose }: Props) {
  const { notes: document } = useReleaseNotes(version);
  const notes = document
    ? presentReleaseNotes(version, document.markdown)
    : null;
  const date = notes?.date ? formatReleaseDate(notes.date) : null;

  return (
    <Modal
      onClose={onClose}
      title="What's new"
      description={`vorkspace ${version}${date ? ` · ${date}` : ""}`}
      size="md"
      className="h-[min(72vh,640px)]"
    >
      <WhatsNewBody version={version} />
    </Modal>
  );
}
