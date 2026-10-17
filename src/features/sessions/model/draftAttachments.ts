import { invoke } from "@tauri-apps/api/core";
import { persistableAttachment } from "./attachments";
import type { Attachment } from "./session";

const cached = new Map<string, Promise<string>>();

/** Persist clipboard bytes once; the draft row always receives metadata only. */
export async function durableDraftAttachments(
  attachments: Attachment[],
): Promise<Attachment[]> {
  return Promise.all(
    attachments.map(async (file) => {
      const temporary = file.path
        ?.replace(/\\/g, "/")
        .includes("/monocode-attachments/");
      if (file.path && !temporary) return persistableAttachment(file);
      let pending = cached.get(file.id);
      if (!pending) {
        pending = (async () => {
          const data =
            file.data ??
            (file.path
              ? await invoke<string>("read_file_base64", { path: file.path })
              : undefined);
          if (data == null)
            throw new Error(
              `Cannot save attachment ${JSON.stringify(file.name)}. Attach the file again.`,
            );
          const path = await invoke<string>("composer_draft_cache_attachment", {
            name: file.name,
            data,
          });
          if (typeof path !== "string" || !path)
            throw new Error(
              `Could not save attachment ${JSON.stringify(file.name)}.`,
            );
          return path;
        })();
        cached.set(file.id, pending);
        void pending.catch(() => cached.delete(file.id));
      }
      // The live turn may be submitted before another render. Keep its metadata
      // reference alongside its existing preview/bytes as soon as the copy lands.
      file.path = await pending;
      return persistableAttachment(file);
    }),
  );
}

/** Missing refs remain in the draft so recovery never silently drops a file. */
export async function checkDraftAttachments(
  attachments: Attachment[],
): Promise<string[]> {
  if (!attachments.length) return [];
  const paths = attachments.flatMap((file) => (file.path ? [file.path] : []));
  const infos = await invoke<{ path: string }[]>("inspect_paths", { paths });
  if (!Array.isArray(infos))
    throw new Error("Could not check restored draft attachments.");
  const normalize = (path: string) => path.replace(/\\/g, "/");
  const found = new Set(infos.map((info) => normalize(info.path)));
  return attachments
    .filter((file) => !file.path || !found.has(normalize(file.path)))
    .map((file) => file.name);
}
