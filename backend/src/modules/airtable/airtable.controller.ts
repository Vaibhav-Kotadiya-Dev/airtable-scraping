import type { NextFunction, Request, Response } from "express";
import { env } from "../../core/config/env";
import { airtableService } from "./airtable.service";

export const airtableController = {
  async getOAuthUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;
      const result = await airtableService.getOAuthUrl(integrationId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async handleOAuthCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const query = req.query as Record<string, unknown>;
      const code = typeof req.query.code === "string" ? req.query.code : undefined;
      const state = typeof req.query.state === "string" ? req.query.state : undefined;

      const oauthError =
        typeof req.query.error === "string" ? (req.query.error as string) : undefined;
      const oauthErrorDescription =
        typeof req.query.error_description === "string"
          ? (req.query.error_description as string)
          : undefined;

      if (!code) {
        res.status(400).json({
          error: "OAuth callback missing `code`",
          oauthError,
          oauthErrorDescription,
          receivedQuery: query,
        });
        return;
      }

      const { integrationId } = await airtableService.handleOAuthCallback(code, state);

      if (!env.frontendRedirectUrl) {
        res.json({ integrationId, success: true });
        return;
      }

      const redirectUrl = new URL(env.frontendRedirectUrl);
      redirectUrl.searchParams.set("integrationId", integrationId);
      redirectUrl.searchParams.set("success", "true");
      res.redirect(redirectUrl.toString());
    } catch (err) {
      next(err);
    }
  },

  async syncAirtable(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        (typeof req.body?.integrationId === "string" && req.body.integrationId) ||
        (typeof req.query.integrationId === "string" && req.query.integrationId) ||
        undefined;

      const result = await airtableService.sync(integrationId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listBases(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;
      const bases = await airtableService.listBases(integrationId);
      res.json({ bases });
    } catch (err) {
      next(err);
    }
  },

  async listTables(req: Request, res: Response, next: NextFunction) {
    try {
      const baseId = typeof req.query.baseId === "string" ? req.query.baseId : undefined;
      const integrationId =
        typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;
      const tables = await airtableService.listTables(baseId, integrationId);
      res.json({ tables });
    } catch (err) {
      next(err);
    }
  },

  async listTickets(req: Request, res: Response, next: NextFunction) {
    try {
      const baseId = typeof req.query.baseId === "string" ? req.query.baseId : undefined;
      const tableId = typeof req.query.tableId === "string" ? req.query.tableId : undefined;
      const integrationId =
        typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;

      const tickets = await airtableService.listTickets(baseId, tableId, integrationId);
      res.json({ tickets });
    } catch (err) {
      next(err);
    }
  },

  async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const integrationId =
        typeof req.query.integrationId === "string" ? req.query.integrationId : undefined;
      const users = await airtableService.listUsers(integrationId);
      res.json({ users });
    } catch (err) {
      next(err);
    }
  },
};

