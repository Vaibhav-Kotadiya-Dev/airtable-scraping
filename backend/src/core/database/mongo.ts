import mongoose from "mongoose";
import { env } from "../config/env";

export async function connectMongo(): Promise<void> {
  const uri = env.mongoUri;
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
}

