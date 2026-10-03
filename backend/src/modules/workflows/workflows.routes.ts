import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { createRulebookController } from "./rulebook.controller.js";
import type { RulebookDraftService } from "./rulebook.service.js";
import { createWorkflowsController } from "./workflows.controller.js";
import type { WorkflowsService } from "./workflows.service.js";

export function createWorkflowsRouter(service: WorkflowsService): Router {
  const router = Router();
  const controller = createWorkflowsController(service);

  router.get("/", requireAuth, controller.list);
  router.post("/", requireAuth, controller.create);
  router.get("/hidden", requireAuth, controller.listHidden);
  router.post("/hidden", requireAuth, controller.hide);
  router.delete("/hidden/:workflowId", requireAuth, controller.unhide);
  router.get("/:workflowId", requireAuth, controller.get);
  router.put("/:workflowId", requireAuth, controller.update);
  router.patch("/:workflowId", requireAuth, controller.update);
  router.delete("/:workflowId", requireAuth, controller.remove);
  router.get("/:workflowId/shares", requireAuth, controller.listShares);
  router.post("/:workflowId/share", requireAuth, controller.share);
  router.delete("/:workflowId/shares/:shareId", requireAuth, controller.removeShare);

  return router;
}

export function createRulebookRouter(service: RulebookDraftService): Router {
  const router = Router();
  const controller = createRulebookController(service);
  router.post("/generate", requireAuth, controller.generate);
  return router;
}
