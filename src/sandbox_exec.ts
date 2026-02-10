import { mustExist, isMacos } from "./os.ts";
import { exec } from "./exec.ts";

export type SandboxExec = {
  readonly sandboxExecPath: string; // /usr/bin/sandbox-exec
  readonly envPath: string; // /usr/bin/env
};

export const detectSandboxExec = async (): Promise<SandboxExec> => {
  if (!isMacos()) throw new Error("macbox: only supported on macOS (darwin).");
  const sandboxExecPath = "/usr/bin/sandbox-exec";
  const envPath = "/usr/bin/env";
  await mustExist(sandboxExecPath, "macbox requires /usr/bin/sandbox-exec (Seatbelt).");
  await mustExist(envPath, "macbox requires /usr/bin/env.");
  return { sandboxExecPath, envPath };
};

export type SandboxRun = {
  readonly profilePath: string;
  readonly params: Record<string, string>;
  readonly workdir: string;
  readonly env: Record<string, string>;
  readonly command: ReadonlyArray<string>;
};

export type SandboxCaptured = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
};

export const runSandboxed = async (s: SandboxExec, r: SandboxRun): Promise<number> => {
  const defs = Object.entries(r.params).flatMap(([k, v]) => [`-D${k}=${v}`]);

  // We execute: sandbox-exec -f <profile> -D... -- /usr/bin/env -i KEY=VAL ... <cmd...>
  const envPairs = Object.entries(r.env).map(([k, v]) => `${k}=${v}`);

  const cmd = [
    s.sandboxExecPath,
    "-f",
    r.profilePath,
    ...defs,
    "--",
    s.envPath,
    "-i",
    ...envPairs,
    ...r.command,
  ];

  // Use spawn for streaming IO
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: r.workdir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const st = await child.status;
  return st.code;
};

const td = new TextDecoder();

const readLimited = async (
  rs: ReadableStream<Uint8Array> | null,
  limitBytes: number,
  onChunk?: (chunk: Uint8Array) => Promise<void> | void,
) => {
  if (!rs) return { text: "", truncated: false };
  const reader = rs.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (onChunk) {
        await onChunk(value);
      }
      if (total < limitBytes) {
        const remaining = limitBytes - total;
        if (value.byteLength <= remaining) {
          chunks.push(value);
          total += value.byteLength;
        } else {
          chunks.push(value.slice(0, remaining));
          total += remaining;
          truncated = true;
        }
      } else {
        truncated = true;
        // continue draining
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  if (chunks.length === 0) return { text: "", truncated };
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { text: td.decode(out).trimEnd(), truncated };
};

export const runSandboxedCapture = async (
  s: SandboxExec,
  r: SandboxRun,
  opts?: { readonly maxBytes?: number; readonly stdin?: "inherit" | "null"; readonly stream?: boolean },
): Promise<SandboxCaptured> => {
  const defs = Object.entries(r.params).flatMap(([k, v]) => [`-D${k}=${v}`]);
  const envPairs = Object.entries(r.env).map(([k, v]) => `${k}=${v}`);

  const cmd = [
    s.sandboxExecPath,
    "-f",
    r.profilePath,
    ...defs,
    "--",
    s.envPath,
    "-i",
    ...envPairs,
    ...r.command,
  ];

  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: r.workdir,
    stdin: opts?.stdin ?? "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const max = opts?.maxBytes ?? (2 * 1024 * 1024);
  const stream = opts?.stream ?? false;
  const streamOut = stream
    ? async (chunk: Uint8Array) => {
      await Deno.stdout.write(chunk);
    }
    : undefined;
  const streamErr = stream
    ? async (chunk: Uint8Array) => {
      await Deno.stderr.write(chunk);
    }
    : undefined;
  const [o, e, st] = await Promise.all([
    readLimited(child.stdout, max, streamOut),
    readLimited(child.stderr, max, streamErr),
    child.status,
  ]);

  return {
    code: st.code,
    stdout: o.text,
    stderr: e.text,
    stdoutTruncated: o.truncated,
    stderrTruncated: e.truncated,
  };
};

export const explainSandboxExec = async (): Promise<string> => {
  const r = await exec(["/usr/bin/sandbox-exec", "--help"], { quiet: true });
  return r.stdout || r.stderr || "";
};
