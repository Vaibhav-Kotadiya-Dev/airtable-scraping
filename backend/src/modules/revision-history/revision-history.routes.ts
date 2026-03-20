import { Router } from "express";
import { revisionHistoryController } from "./revision-history.controller";

export const revisionHistoryRouter = Router();

revisionHistoryRouter.get("/session/status", revisionHistoryController.getWebSessionStatus);
revisionHistoryRouter.post("/scrape", revisionHistoryController.scrapeRevisionHistory);
revisionHistoryRouter.post("/session/import", revisionHistoryController.importWebSession);
revisionHistoryRouter.get("/activities", revisionHistoryController.listRevisionActivities);

