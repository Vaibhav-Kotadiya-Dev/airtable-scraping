import "dotenv/config";
import { createApp } from "./core/http/app";
import { connectMongo } from "./core/database/mongo";
import { env } from "./core/config/env";

async function main() {
  await connectMongo();

  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[backend] failed to start", err);
  process.exit(1);
});

