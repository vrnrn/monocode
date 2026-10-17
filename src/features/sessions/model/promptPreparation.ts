import { applyFileMentionsToTurn } from "../../files/model/fileMentions";
import { applyNotesToTurn } from "../../notes";
import {
  applySkillsToTurn,
  warmNativeSkills,
  isNativeCommandPrompt,
  type SkillCatalogContext,
} from "../../skills/model/skills";
import { nativeCommandPrompt } from "../../../integrations/harness/core/nativeCommands";
import { applyTicketContextToTurn } from "../../inbox/model/ticketContext";

export async function preparePrompt(
  text: string,
  context: SkillCatalogContext,
): Promise<string> {
  warmNativeSkills(context);
  if (isNativeCommandPrompt(text, context.harness))
    return nativeCommandPrompt(context.harness, text);
  const withFiles = await applyFileMentionsToTurn(text, context.cwd);
  const withNotes = await applyNotesToTurn(withFiles);
  const withSkills = await applySkillsToTurn(withNotes, context);
  return applyTicketContextToTurn(withSkills, context.cwd);
}
