import { completeText } from "../../lib/llm/index.js";
import { getUserModelSettings } from "../../lib/userSettings.js";
import { accessAuthority } from "../access/access.composition.js";
import { createContentTextService } from "../content/contentText.service.js";
import { RulebookDraftService } from "./rulebook.service.js";
import { DrizzleRulebookRepository } from "./rulebook.repository.js";
import { DrizzleWorkflowsRepository } from "./workflows.repository.js";
import { createRulebookRouter, createWorkflowsRouter } from "./workflows.routes.js";
import { WorkflowsService } from "./workflows.service.js";

export function createProductionWorkflowsService(): WorkflowsService {
  return new WorkflowsService(new DrizzleWorkflowsRepository(), accessAuthority);
}

export function createProductionRulebookService(): RulebookDraftService {
  return new RulebookDraftService(
    new DrizzleRulebookRepository(),
    {
      async canReadDocument(documentId, actor) {
        return (
          await accessAuthority.decide({
            actor,
            resource: { kind: "document", id: documentId },
            action: "read_document",
          })
        ).allowed;
      },
    },
    createContentTextService(),
    {
      async complete({ actor, systemPrompt, userPrompt }) {
        const { tabularModel, aiRuntime } = await getUserModelSettings(actor.userId);
        return completeText({
          model: tabularModel,
          task: "tabular",
          systemPrompt,
          user: userPrompt,
          maxTokens: 4096,
          runtime: aiRuntime,
        });
      },
    },
  );
}

export const workflowsRouter = createWorkflowsRouter(createProductionWorkflowsService());
export const rulebookRouter = createRulebookRouter(createProductionRulebookService());
