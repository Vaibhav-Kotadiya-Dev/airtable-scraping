import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "../config/env";
import { registerRoutes } from "./routes";
import { errorHandler } from "./errorHandler";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.frontendOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  registerRoutes(app);

  app.use(errorHandler);
  return app;
}

