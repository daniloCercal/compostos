import type { NextFunction, Request, Response } from "express";
import { isProduction } from "../config/env";

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof Error) {
    console.error("[error-handler]", error);
    res.status(500).json({
      error: "erro interno",
      ...(isProduction ? {} : { detail: error.message })
    });
    return;
  }

  console.error("[error-handler] erro desconhecido", error);
  res.status(500).json({ error: "erro interno" });
}
