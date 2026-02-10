const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

const hasPathSeparators = (s: string): boolean =>
  s.includes("/") || s.includes("\\");

const hasControlChars = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) return true;
  }
  return false;
};

const assertSafeSegment = (value: string, label: string): string => {
  const v = value.trim();
  if (!v) {
    throw new Error(`macbox: ${label} must not be empty`);
  }
  if (v === "." || v === "..") {
    throw new Error(`macbox: invalid ${label}: ${value}`);
  }
  if (hasPathSeparators(v)) {
    throw new Error(
      `macbox: invalid ${label} '${value}' (path separators are not allowed)`,
    );
  }
  if (hasControlChars(v)) {
    throw new Error(
      `macbox: invalid ${label} '${value}' (control characters are not allowed)`,
    );
  }
  if (!SAFE_SEGMENT.test(v)) {
    throw new Error(
      `macbox: invalid ${label} '${value}' (allowed: letters, numbers, '.', '_', '-')`,
    );
  }
  return v;
};

export const validateWorktreeName = (name: string): string =>
  assertSafeSegment(name, "worktree name");

export const validateWorktreePrefix = (prefix: string): string =>
  assertSafeSegment(prefix, "worktree prefix");

export type ParsedSessionId = {
  readonly repoId: string;
  readonly worktreeName: string;
  readonly id: string;
};

export const parseSessionId = (id: string): ParsedSessionId => {
  const parts = id.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `macbox: invalid session id '${id}'. Expected format: <repoId>/<worktreeName>`,
    );
  }
  const repoId = assertSafeSegment(parts[0], "session repoId");
  const worktreeName = validateWorktreeName(parts[1]);
  return { repoId, worktreeName, id: `${repoId}/${worktreeName}` };
};
