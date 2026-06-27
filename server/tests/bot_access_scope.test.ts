import "./setup-env";

import request from "supertest";

import { createBotRouterApp, buildPrincipal } from "./router-test-utils";

const SAMPLE_BOT = {
  id: "bot-1",
  name: "Alpha",
  token: "super-secret-token",
  commands: [],
  isActive: true,
  createdAt: "2026-03-26T12:00:00.000Z",
  updatedAt: "2026-03-26T12:00:00.000Z",
};

function createService(overrides: Record<string, unknown> = {}) {
  return {
    list: jest.fn().mockResolvedValue([]),
    listStatus: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    restart: jest.fn(),
    remove: jest.fn(),
    listLogs: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("bot access scoping", () => {
  test("scoped principal cannot read a bot outside its botIds", async () => {
    const getById = jest.fn().mockResolvedValue(SAMPLE_BOT);
    const service = createService({ getById });
    const principal = buildPrincipal({ role: "user", scope: "assigned", botIds: ["other-bot"] });
    const app = createBotRouterApp(service, principal);

    const response = await request(app).get("/bots/bot-1");

    expect(response.status).toBe(403);
    // Negação acontece antes de tocar no service (sem vazar existência do bot).
    expect(getById).not.toHaveBeenCalled();
  });

  test("principal with matching scope reads the bot but never its token", async () => {
    const getById = jest.fn().mockResolvedValue(SAMPLE_BOT);
    const service = createService({ getById });
    const principal = buildPrincipal({ role: "user", scope: "assigned", botIds: ["bot-1"] });
    const app = createBotRouterApp(service, principal);

    const response = await request(app).get("/bots/bot-1");

    expect(response.status).toBe(200);
    expect(response.body.bot.id).toBe("bot-1");
    expect(response.body.bot.token).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("super-secret-token");
  });
});
