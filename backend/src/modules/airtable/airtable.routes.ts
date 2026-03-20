import { Router } from "express";
import { airtableController } from "./airtable.controller";

export const airtableRouter = Router();

airtableRouter.get("/oauth/url", airtableController.getOAuthUrl);
airtableRouter.get("/oauth/callback", airtableController.handleOAuthCallback);

airtableRouter.post("/sync", airtableController.syncAirtable);
airtableRouter.get("/bases", airtableController.listBases);
airtableRouter.get("/tables", airtableController.listTables);
airtableRouter.get("/tickets", airtableController.listTickets);
airtableRouter.get("/users", airtableController.listUsers);

