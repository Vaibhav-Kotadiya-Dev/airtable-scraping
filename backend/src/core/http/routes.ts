import type { Express } from "express";
import { Router } from "express";
import { airtableRouter } from "../../modules/airtable/airtable.routes";
import { revisionHistoryRouter } from "../../modules/revision-history/revision-history.routes";

export function registerRoutes(app: Express) {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/airtable", airtableRouter);

  app.use("/api/airtable/revision-history", revisionHistoryRouter);
}

export { Router };

