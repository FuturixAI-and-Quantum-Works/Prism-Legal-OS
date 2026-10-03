import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import swaggerJsdoc from "swagger-jsdoc";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createDownloadsController } from "../../src/modules/downloads/downloads.controller.js";
import { createDownloadsRouter } from "../../src/modules/downloads/downloads.routes.js";
import { DownloadsService } from "../../src/modules/downloads/downloads.service.js";
import {
  createUsersController,
  type UsersControllerDependencies,
} from "../../src/modules/users/users.controller.js";
import { createUsersRouter } from "../../src/modules/users/users.routes.js";
import { UsersService } from "../../src/modules/users/users.service.js";

function registeredRoutes(router: express.Router): Set<string> {
  const stack = Reflect.get(router, "stack");
  if (!Array.isArray(stack)) throw new Error("Express router stack is unavailable");
  return new Set(
    stack.flatMap((layer: unknown) => {
      if (!layer || typeof layer !== "object") return [];
      const route = Reflect.get(layer, "route");
      if (!route || typeof route !== "object") return [];
      const path = Reflect.get(route, "path");
      const methods = Reflect.get(route, "methods");
      if (typeof path !== "string" || !methods || typeof methods !== "object") return [];
      return Object.entries(methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${path}`);
    }),
  );
}

function usersDependencies(profiles: UsersService): UsersControllerDependencies {
  return { profiles, accounts: Object.create(null), ai: Object.create(null) };
}

describe("downloads and users route contracts", () => {
  it("preserves every endpoint", () => {
    const downloads = registeredRoutes(
      createDownloadsRouter(Object.create(DownloadsService.prototype), () => "attachment"),
    );
    expect(downloads).toEqual(new Set(["GET /local/:token", "GET /:token"]));

    const users = registeredRoutes(
      createUsersRouter(usersDependencies(Object.create(UsersService.prototype))),
    );
    expect(users).toEqual(
      new Set([
        "PUT /onboarding",
        "POST /profile",
        "GET /profile",
        "PATCH /profile",
        "GET /ai/connections",
        "POST /ai/connections",
        "PUT /ai/connections/:connectionId",
        "DELETE /ai/connections/:connectionId",
        "POST /ai/connections/:connectionId/test",
        "GET /ai/models",
        "GET /ai/preferences",
        "PUT /ai/preferences/:task",
        "DELETE /account",
      ]),
    );
  });

  it("keeps public routes and transport modules free of infrastructure imports", async () => {
    for (const path of [
      "../../src/modules/downloads/downloads.routes.ts",
      "../../src/modules/downloads/downloads.controller.ts",
      "../../src/modules/users/users.routes.ts",
      "../../src/modules/users/users.controller.ts",
    ]) {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const imports = file.statements.flatMap((statement) => {
        if (
          (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          return [statement.moduleSpecifier.text];
        }
        return [];
      });
      expect(imports).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/(?:^|\/)(?:db|storage|llm|aiRegistry)(?:\/|\.|$)/),
        ]),
      );
    }
  });

  it("mounts the user router only at the supported singular path", async () => {
    const source = await readFile(
      new URL("../../src/productionDependencies.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('{ path: "/user", router: userRouter }');
    expect(source).not.toContain('{ path: "/users", router: userRouter }');
  });

  it("publishes user and download paths in OpenAPI", () => {
    const specification = swaggerJsdoc({
      definition: {
        openapi: "3.0.0",
        info: { title: "User and download contract", version: "1.0.0" },
      },
      apis: [
        fileURLToPath(new URL("../../src/modules/users/users.openapi.routes.ts", import.meta.url)),
        fileURLToPath(
          new URL("../../src/modules/downloads/downloads.openapi.routes.ts", import.meta.url),
        ),
      ],
    });
    expect(Reflect.get(specification, "paths")).toMatchObject({
      "/user/profile": { get: {}, post: {}, patch: {} },
      "/user/account": { delete: {} },
      "/download/{token}": { get: {} },
    });
  });

  it("preserves download response headers and profile validation", async () => {
    const downloads = Object.create(DownloadsService.prototype) as DownloadsService;
    downloads.getLocal = vi.fn(async () => ({
      bytes: new TextEncoder().encode("contents").buffer,
      filename: "review.txt",
      disposition: "inline",
    }));
    const users = Object.create(UsersService.prototype) as UsersService;
    users.updateProfile = vi.fn();
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      Reflect.set(res.locals, "auth", {
        user: { id: "user-1", email: "User@Example.com" },
      });
      next();
    });
    app.get(
      "/download/local/:token",
      createDownloadsController(
        downloads,
        (disposition, filename) => `${disposition}; filename="${filename}"`,
      ).local,
    );
    app.patch("/user/profile", createUsersController(usersDependencies(users)).updateProfile);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server unavailable");
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const download = await fetch(`${origin}/download/local/token`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(download.headers.get("content-disposition")).toBe('inline; filename="review.txt"');
      await expect(download.text()).resolves.toBe("contents");

      const invalid = await fetch(`${origin}/user/profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toEqual({
        detail: "Unsupported profile field: role",
      });
      expect(users.updateProfile).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
