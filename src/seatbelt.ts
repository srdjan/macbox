import { writeText } from "./fs.ts";

// This profile is intentionally minimal.
// It is designed to:
// - allow processes and networking (default)
// - restrict file writes to a small allowlist (worktree + git dirs + /dev + some temp)
// - allow reads from system + worktree + git dirs
//
// We use sandbox-exec -D params to avoid hardcoding absolute paths.

export type SeatbeltParams = {
  readonly worktree: string;
  readonly gitCommonDir: string;
  readonly gitDir: string;
  readonly debug: boolean;
  readonly network: boolean;
  readonly exec: boolean;
  readonly extraReadPaths?: ReadonlyArray<string>;
  readonly extraWritePaths?: ReadonlyArray<string>;
  readonly allowMachLookupAll?: boolean;
  readonly machServices?: ReadonlyArray<string>;
};

const sbEscape = (s: string): string => {
  // SBPL strings are double-quoted; keep this conservative.
  if (s.includes('"') || s.includes("\n") || s.includes("\r")) {
    throw new Error(`Invalid SBPL path (contains quotes/newlines): ${s}`);
  }
  return s;
};

const sbSubpath = (p: string) => `  (subpath "${sbEscape(p)}")`;

const sbMachAllow = (
  allowAll: boolean | undefined,
  services: ReadonlyArray<string> | undefined,
): string => {
  if (allowAll) return "(allow mach-lookup)\n";
  if (!services || services.length === 0) return "";
  const lines = services.map((s) => `  (global-name "${sbEscape(s)}")`).join(
    "\n",
  );
  return `(allow mach-lookup\n${lines}\n)\n`;
};

const sbExtraSubpaths = (paths: ReadonlyArray<string> | undefined): string => {
  if (!paths || paths.length === 0) return "";
  return "\n" + paths.map(sbSubpath).join("\n") + "\n";
};

export const seatbeltProfile = (p: SeatbeltParams): string => {
  const dbg = p.debug ? "(debug deny)\n" : "";
  const net = p.network
    ? "(allow network-outbound)\n(allow network-inbound)\n(allow system-socket)\n"
    : "(deny network*)\n";

  const proc = p.exec
    ? "(allow process*)\n"
    : "(allow process-info)\n(deny process-exec)\n";

  const mach = sbMachAllow(p.allowMachLookupAll, p.machServices);

  const extraRead = sbExtraSubpaths(p.extraReadPaths);
  const extraWrite = sbExtraSubpaths(p.extraWritePaths);

  // NOTE: we avoid (allow default). We allow explicit reads + write roots.
  // Some programs may require extra read-only paths; we keep a sane baseline.
  return `;; macbox generated profile
(version 1)
${dbg}(deny default)

;; Process operations
${proc}(allow signal)

;; Allow common sysctl reads (needed by standard libs)
(allow sysctl-read)

;; Allow terminal ioctl operations (e.g., raw mode)
(allow file-ioctl
  (subpath "/dev")
)

;; Allow Notification Center shared memory reads (used by system networking stack)
(allow ipc-posix-shm-read-data
  (ipc-posix-name "apple.shm.notification_center")
)

;; Mach services (IPC)
${mach}
;; Read-only system paths (exec + dynamic libs)
(allow file-read*
  (literal "/")
  (subpath "/System")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/Library")
  (subpath "/opt/homebrew")
  (subpath "/Applications")
  (subpath "/private/etc")
  (subpath "/private/var/run")
  (subpath "/private/var/select")
  (subpath "/private/tmp")
  (subpath "/tmp")
  (subpath "/var")
  (subpath "/etc")
  (subpath "/dev")
  (subpath (param "WORKTREE"))
  (subpath (param "GIT_COMMON_DIR"))
  (subpath (param "GIT_DIR"))
${extraRead}
)

;; Write allowlist
(deny file-write*)
(allow file-write*
  (subpath "/dev")
  (subpath "/private/tmp")
  (subpath "/private/var/tmp")
  (literal "/private/var/run/mDNSResponder")
  (subpath (param "WORKTREE"))
  (subpath (param "GIT_COMMON_DIR"))
  (subpath (param "GIT_DIR"))
${extraWrite}
)

${net}
`;
};

export const writeSeatbeltProfile = async (
  filePath: string,
  p: SeatbeltParams,
) => {
  await writeText(filePath, seatbeltProfile(p));
};
