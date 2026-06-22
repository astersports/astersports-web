/**
 * Operator CLI — send an instruction (create a task) to the Manus Agent API.
 *
 * Usage:
 *   MANUS_API_KEY=sk-... pnpm tsx scripts/manusTask.ts "your instruction to Manus"
 * or put MANUS_API_KEY in a gitignored .env (auto-loaded below) and run:
 *   pnpm tsx scripts/manusTask.ts "your instruction to Manus"
 *
 * Standalone operator tool — NOT part of the app runtime, not wired into any
 * route or the money path. Exercises the server/_core/manus client. The key is a
 * full-access secret: keep it in env, never commit it, never paste it anywhere
 * shared.
 */
import "dotenv/config";
import {
  createManusClient,
  ManusApiError,
  ManusUnavailableError,
} from "../server/_core/manus";

async function main(): Promise<void> {
  const instruction = process.argv.slice(2).join(" ").trim();
  if (!instruction) {
    console.error('Usage: pnpm tsx scripts/manusTask.ts "your instruction to Manus"');
    process.exit(2);
  }

  const client = createManusClient();
  try {
    const task = await client.createTask({ message: { content: instruction } });
    console.log("Manus task created:");
    console.log(JSON.stringify(task, null, 2));
  } catch (err) {
    if (err instanceof ManusUnavailableError) {
      console.error("MANUS_API_KEY is not set — export it or add it to a gitignored .env.");
      process.exit(1);
    }
    if (err instanceof ManusApiError) {
      console.error(
        `Manus API error [${err.code}] (HTTP ${err.status}, request ${err.requestId ?? "?"}): ${err.message}`
      );
      process.exit(1);
    }
    throw err;
  }
}

void main();
