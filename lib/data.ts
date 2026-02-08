import fs from "node:fs/promises";
import path from "node:path";
import type { Club } from "./types";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dataPath = path.join(DATA_DIR, "clubs.json");
const samplePath = path.join(process.cwd(), "data", "clubs.sample.json");

export async function loadClubs(): Promise<Club[]> {
  try {
    const payload = await fs.readFile(dataPath, "utf8");
    return JSON.parse(payload) as Club[];
  } catch (error) {
    const payload = await fs.readFile(samplePath, "utf8");
    return JSON.parse(payload) as Club[];
  }
}
