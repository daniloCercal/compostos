import "./setup-env";

import request from "supertest";

import { createBotRouterApp } from "./router-test-utils";

function createService() {
  return {
    list: jest.fn().mockResolvedValue([
      {
        id: "bot-1",
        name: "Alpha",
        token: "super-secret-token",
        commands: [],
        isActive: true,
        createdAt: "2026-03-26T12:00:00.000Z",
        updatedAt: "2026-03-26T12:00:00.000Z",
      },
    ]),
    listRuntimeStatus: jest.fn().mockResolvedValue([]),
    getRuntimeStatusByBotId: jest.fn().mockResolvedValue(null),
    getById: jest.fn().mockResolvedValue({
      id: "bot-1",
      name: "Alpha",
      token: "super-secret-token",
      commands: [],
      isActive: true,
      createdAt: "2026-03-26T12:00:00.000Z",
      updatedAt: "2026-03-26T12:00:00.000Z",
    }),
    create: jest.fn(),
    update: jest.fn(),
    restart: jest.fn(),
    remove: jest.fn(),
    listLogs: jest.fn().mockResolvedValue([]),
  };
}

describe("bot token exposure", () => {
  test("never returns bot tokens from GET responses", async () => {
    const app = createBotRouterApp(createService());

    const listResponse = await request(app).get("/bots");
    const detailResponse = await request(app).get("/bots/bot-1");

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(listResponse.body.bots[0].token).toBeUndefined();
    expect(detailResponse.body.bot.token).toBeUndefined();
    expect(JSON.stringify(listResponse.body)).not.toContain("super-secret-token");
    expect(JSON.stringify(detailResponse.body)).not.toContain("super-secret-token");
  });
});
