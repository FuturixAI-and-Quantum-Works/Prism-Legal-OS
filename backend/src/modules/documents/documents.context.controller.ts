import { documentActor, documentEndpoint } from "./documents.http.js";
import type { DocumentContextService } from "./documents.context.service.js";
import type { DocumentInsightsService } from "./documents.insights.service.js";
import {
  contextDocumentSchema,
  contextFileParamsSchema,
  documentIdParamsSchema,
} from "./documents.validators.js";

export function createDocumentsContextController(
  service: DocumentContextService,
  insights: DocumentInsightsService,
) {
  return {
    list: documentEndpoint(async (req, res) => {
      const { documentId } = documentIdParamsSchema.parse(req.params);
      res.json(await service.list(documentActor(res), documentId));
    }),
    add: documentEndpoint(async (req, res) => {
      const { documentId } = documentIdParamsSchema.parse(req.params);
      const { context_document_id: contextDocumentId } = contextDocumentSchema.parse(req.body);
      const result = await service.add(documentActor(res), documentId, contextDocumentId);
      res.status(result.status).json(result.body);
    }),
    remove: documentEndpoint(async (req, res) => {
      const { documentId, contextFileId } = contextFileParamsSchema.parse(req.params);
      await service.remove(documentActor(res), documentId, contextFileId);
      res.json({ ok: true });
    }),
    insights: documentEndpoint(async (req, res) => {
      const { documentId } = documentIdParamsSchema.parse(req.params);
      res.json(await insights.generate(documentActor(res), documentId));
    }),
  };
}
