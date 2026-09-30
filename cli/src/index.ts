// Import parsers to register them before CLI setup
import "./parsers/claude-code.js";
import "./parsers/codex.js";
import "./parsers/gsd.js";
import "./parsers/gemini-cli.js";
import "./parsers/hermes.js";
import "./parsers/mimocode.js";
import "./parsers/mcode.js";
import "./parsers/mirasim.js";
import "./parsers/copilot-cli.js";
import "./parsers/oh-my-pi.js";
import "./parsers/opencode.js";
import "./parsers/openclaw.js";
import "./parsers/qwen-code.js";
import "./parsers/kimi-code.js";
import "./parsers/letcode.js";
import "./parsers/droid.js";
import "./parsers/pi-coding-agent.js";
import "./parsers/qwenpaw.js";
import "./parsers/cline.js";
import "./parsers/kiro.js";
import "./parsers/roo-code.js";
import "./parsers/snow.js";
import "./parsers/snow-app.js";
import "./parsers/cursor.js";
import "./parsers/zcode.js";
import "./parsers/qodercli.js";
import "./parsers/grok-build.js";
import "./parsers/atomcode.js";
import "./parsers/dsh.js";
import "./parsers/cherry-studio.js";

import { createCli } from "./cli.js";
import { isMainModule } from "./infrastructure/runtime/main-module.js";
import { logger } from "./utils/logger.js";

/** Exit code conventionally used for "terminated by SIGINT". */
const EXIT_CANCELLED = 130;

export function normalizeArgv(argv: string[]) {
  return argv.filter((arg, index) => index < 2 || arg !== "--");
}

export async function run(argv = process.argv) {
  const program = createCli();
  await program.parseAsync(normalizeArgv(argv));
}

export function reportFatalError(error: unknown): void {
  // @inquirer/prompts rejects with ExitPromptError when the user hits Ctrl+C.
  // That is a cancellation, not a crash, so it must not print a stack trace.
  if (error instanceof Error && error.name === "ExitPromptError") {
    process.exitCode = EXIT_CANCELLED;
    return;
  }

  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  // Never `void` this: without a catch every rejecting command handler surfaces
  // as an unhandled rejection with a raw stack trace instead of CLI output.
  run().catch(reportFatalError);
}
