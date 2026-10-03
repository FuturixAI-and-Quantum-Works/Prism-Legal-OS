import { accessAuthority } from "../access/access.composition.js";
import type { ObjectStore } from "../../storage/types.js";
import type { DocumentCreator } from "../documents/documents.service.js";
import { TemplatesAuthorizationPolicy } from "./templates.policy.js";
import { DrizzleTemplatesRepository } from "./templates.repository.js";
import { createTemplatesRouter } from "./templates.routes.js";
import { TemplatesService } from "./templates.service.js";
import { TemplateStorageCoordinator } from "./templates.storage.js";

function createProductionTemplatesService(
  documents: DocumentCreator,
  objectStore: ObjectStore,
): TemplatesService {
  const repository = new DrizzleTemplatesRepository();
  return new TemplatesService(
    repository,
    new TemplatesAuthorizationPolicy(repository, accessAuthority),
    accessAuthority,
    new TemplateStorageCoordinator(objectStore),
    documents,
  );
}

export function createProductionTemplatesRouter(
  documents: DocumentCreator,
  objectStore: ObjectStore,
) {
  return createTemplatesRouter(createProductionTemplatesService(documents, objectStore));
}
