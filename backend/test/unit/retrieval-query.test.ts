import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  isConfigured: false,
  queryCollection: vi.fn(),
}));
const authority = vi.hoisted(() => ({
  decide: vi.fn(),
  grants: {
    listProjectGrants: vi.fn(),
    listWorkspaceGrants: vi.fn(),
  },
}));
const repository = vi.hoisted(() => ({
  findCollection: vi.fn(),
  findWorkspaceScope: vi.fn(),
  findProjectScope: vi.fn(),
  findScopeEntriesByVersionIds: vi.fn(),
  listAccessibleSources: vi.fn(),
}));

vi.mock("../../src/modules/retrieval/retrieval.composition.js", () => ({
  retrievalProvider: provider,
}));
vi.mock("../../src/modules/access/access.composition.js", () => ({
  accessAuthority: authority,
}));
vi.mock("../../src/modules/retrieval/retrieval.repository.js", () => ({
  retrievalRepository: repository,
}));

import {
  accessibleRetrievalScopes,
  searchRetrievalSources,
} from "../../src/modules/retrieval/retrieval.query.js";

describe("retrieval query access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.isConfigured = false;
  });

  it("performs no authorization, database, or provider work while disabled", async () => {
    await expect(
      searchRetrievalSources({
        userId: "user-1",
        workspaceId: "workspace-1",
        query: "termination rights",
      }),
    ).resolves.toMatchObject({
      ok: false,
      disabled: true,
      code: "rag_disabled",
      results: [],
    });

    expect(authority.decide).not.toHaveBeenCalled();
    expect(repository.findCollection).not.toHaveBeenCalled();
    expect(provider.queryCollection).not.toHaveBeenCalled();
  });

  it("rejects a scoped query before collection lookup when authority denies access", async () => {
    provider.isConfigured = true;
    authority.decide.mockResolvedValue({ allowed: false, reason: "forbidden" });

    await expect(
      searchRetrievalSources({
        userId: "user-1",
        userEmail: "USER@EXAMPLE.COM",
        projectId: "project-1",
        query: "renewal",
      }),
    ).resolves.toMatchObject({ ok: false, scope: null, results: [] });

    expect(authority.decide).toHaveBeenCalledWith({
      actor: { userId: "user-1", email: "user@example.com" },
      resource: { kind: "project", id: "project-1" },
      action: "read",
    });
    expect(repository.findCollection).not.toHaveBeenCalled();
    expect(provider.queryCollection).not.toHaveBeenCalled();
  });

  it("constrains provider result enrichment to the authorized scope", async () => {
    provider.isConfigured = true;
    authority.decide.mockResolvedValue({ allowed: true, grant: {} });
    const scope = {
      type: "workspace",
      id: "workspace-1",
      name: "Legal",
      ownerUserId: "owner-1",
    };
    repository.findWorkspaceScope.mockResolvedValue(scope);
    repository.findCollection.mockResolvedValue({ collectionName: "collection-1" });
    provider.queryCollection.mockResolvedValue([
      {
        rank: 1,
        document_id: "version-1",
        metadata: { document_url: { unsafe: true } },
      },
    ]);
    repository.findScopeEntriesByVersionIds.mockResolvedValue([]);

    const result = await searchRetrievalSources({
      userId: "user-1",
      workspaceId: "workspace-1",
      query: "renewal",
    });

    expect(repository.findScopeEntriesByVersionIds).toHaveBeenCalledWith(scope, ["version-1"]);
    expect(result.results).toEqual([
      expect.objectContaining({ version_id: "version-1", document_url: null }),
    ]);
  });

  it("derives accessible source scopes from the unified authority", async () => {
    authority.grants.listProjectGrants.mockResolvedValue(new Map([["project-1", {}]]));
    authority.grants.listWorkspaceGrants.mockResolvedValue(new Map([["workspace-1", {}]]));

    await expect(
      accessibleRetrievalScopes({ userId: "user-1", userEmail: "USER@EXAMPLE.COM" }),
    ).resolves.toEqual({
      projectIds: ["project-1"],
      workspaceIds: ["workspace-1"],
    });
    const actor = { userId: "user-1", email: "user@example.com" };
    expect(authority.grants.listProjectGrants).toHaveBeenCalledWith(actor);
    expect(authority.grants.listWorkspaceGrants).toHaveBeenCalledWith(actor);
  });
});
