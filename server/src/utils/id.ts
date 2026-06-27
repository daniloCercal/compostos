import { randomUUID } from "node:crypto";

export function createId(): string {
  return randomUUID();
}

export function utcIsoNow(): string {
  return new Date().toISOString();
}

