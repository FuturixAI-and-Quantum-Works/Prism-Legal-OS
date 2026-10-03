import { AccessAuthority } from "../../src/modules/access/access.authority.js";
import type { AccessGrantReader } from "../../src/modules/access/access.repository.js";
import type {
  AccessActor,
  AccessGrant,
  AccessResource,
} from "../../src/modules/access/access.types.js";

export const ownerGrant: AccessGrant = {
  role: "owner",
  source: "owner",
  documentRole: null,
  documentLifecycle: null,
};

export function stubAccessAuthority(
  findGrant: (actor: AccessActor, resource: AccessResource) => AccessGrant | null = () =>
    ownerGrant,
  grants: Partial<AccessGrantReader> = {},
): AccessAuthority {
  const repository: AccessGrantReader = {
    isGlobalAdmin: async () => false,
    findGrant: async (actor, resource) => findGrant(actor, resource),
    listProjectGrants: async () => new Map(),
    listWorkspaceGrants: async () => new Map(),
    listDocumentGrants: async () => new Map(),
    listTabularReviewGrants: async () => new Map(),
    listWorkflowGrants: async () => new Map(),
    listTemplateGrants: async () => new Map(),
    ...grants,
  };
  return new AccessAuthority(repository);
}
