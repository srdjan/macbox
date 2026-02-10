import { exec } from "./exec.ts";
import { mustExist } from "./os.ts";
import { writeText } from "./fs.ts";

export type TraceRequest = {
  readonly outFile: string;
  readonly start: string; // log show format (local time)
  readonly end: string; // log show format (local time)
  readonly session: string;
  readonly commandLine: string;
};

// Chromium recommends this predicate for sandbox violation debugging.
// We also filter to denials to keep the output focused.
export const defaultSandboxViolationPredicate =
  '(((processID == 0) AND (senderImagePath CONTAINS "/Sandbox")) OR (subsystem == "com.apple.sandbox.reporting")) AND (eventMessage CONTAINS[c] "deny")';

export const collectSandboxViolations = async (
  r: TraceRequest,
  predicate: string = defaultSandboxViolationPredicate,
): Promise<void> => {
  const logPath = "/usr/bin/log";
  await mustExist(logPath, "macbox trace requires /usr/bin/log.");

  const header = `# macbox sandbox violations\n` +
    `session: ${r.session}\n` +
    `start: ${r.start}\n` +
    `end: ${r.end}\n` +
    `command: ${r.commandLine}\n` +
    `predicate: ${predicate}\n\n`;

  const res = await exec([
    logPath,
    "show",
    "--style",
    "syslog",
    "--start",
    r.start,
    "--end",
    r.end,
    "--predicate",
    predicate,
    "--info",
    "--debug",
  ], { quiet: true });

  const body = res.code === 0
    ? (res.stdout.length
      ? res.stdout
      : "(no sandbox denials captured in the selected time window)\n")
    : `log show failed (code=${res.code})\n${res.stderr || res.stdout}\n`;

  await writeText(r.outFile, header + body);
};
