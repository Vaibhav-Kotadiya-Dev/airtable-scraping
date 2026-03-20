import type { NextFunction, Request, Response } from "express";
import { revisionHistoryService } from "./revision-history.service";

export const revisionHistoryController = {
  async importWebSession(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.body?.integrationId === "string" ? (req.body.integrationId as string) : undefined;
      const cookieHeader =
        typeof req.body?.cookieHeader === "string" ? (req.body.cookieHeader as string) : undefined;

      if (!cookieHeader) {
        res.status(400).json({ error: "cookieHeader is required" });
        return;
      }

      const result = await revisionHistoryService.importWebSession({
        ...(integrationId ? { integrationId } : {}),
        cookieHeader,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getWebSessionStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.query.integrationId === "string" ? (req.query.integrationId as string) : undefined;
      const baseId = typeof req.query.baseId === "string" ? (req.query.baseId as string) : undefined;
      const tableId = typeof req.query.tableId === "string" ? (req.query.tableId as string) : undefined;

      const result = await revisionHistoryService.getWebSessionStatus({
        ...(integrationId ? { integrationId } : {}),
        ...(baseId ? { baseId } : {}),
        ...(tableId ? { tableId } : {}),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async scrapeRevisionHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.body?.integrationId === "string" ? (req.body.integrationId as string) : undefined;
      const baseId = typeof req.body?.baseId === "string" ? (req.body.baseId as string) : undefined;
      const tableId = typeof req.body?.tableId === "string" ? (req.body.tableId as string) : undefined;
      const limit = typeof req.body?.limit === "number" ? req.body.limit : 200;

      const args: {
        integrationId?: string;
        baseId?: string;
        tableId?: string;
        limit: number;
      } = {
        limit,
        ...(integrationId ? { integrationId } : {}),
        ...(baseId ? { baseId } : {}),
        ...(tableId ? { tableId } : {}),
      };

      const result = await revisionHistoryService.scrapeRevisionHistory(args);

      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listRevisionActivities(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.query.integrationId === "string" ? (req.query.integrationId as string) : undefined;
      const baseId = typeof req.query.baseId === "string" ? (req.query.baseId as string) : undefined;
      const tableId = typeof req.query.tableId === "string" ? (req.query.tableId as string) : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;

      const result = await revisionHistoryService.listRevisionActivities({
        limit: Number.isFinite(limit) ? limit : 100,
        ...(integrationId ? { integrationId } : {}),
        ...(baseId ? { baseId } : {}),
        ...(tableId ? { tableId } : {}),
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

