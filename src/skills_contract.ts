export type ContractEnvVar = {
  readonly name: string;
  readonly description: string;
};

export type SkillsResultFile = {
  /** Environment variable that points to an absolute result file path (inside the worktree). */
  readonly envVar: "MACBOX_RESULT_PATH";
  /** Environment variable that declares the intended result format. */
  readonly formatEnvVar: "MACBOX_RESULT_FORMAT";
  /** Current default format written by skills that follow the contract. */
  readonly defaultFormat: "json";
  /** Notes for skill authors. */
  readonly notes: string;
};

export type SkillsContractV1 = {
  readonly schema: "macbox.skills.contract.v1";
  /** Environment variables injected by macbox for every skill run. */
  readonly env: ReadonlyArray<ContractEnvVar>;
  /** Optional result file contract. */
  readonly resultFile: SkillsResultFile;
};

export const skillsContractV1: SkillsContractV1 = {
  schema: "macbox.skills.contract.v1",
  env: [
    {
      name: "MACBOX_WORKTREE",
      description: "Absolute path to the sandbox worktree root.",
    },
    {
      name: "MACBOX_SKILL",
      description: "Skill name being executed.",
    },
    {
      name: "MACBOX_SKILL_DIR",
      description: "Absolute path to the skill directory inside the worktree.",
    },
    {
      name: "MACBOX_SESSION",
      description: "A short session identifier for this invocation.",
    },
    {
      name: "MACBOX_SKILL_ARGS_JSON",
      description: "JSON array of args passed after `--` (same as process argv tail).",
    },
  ],
  resultFile: {
    envVar: "MACBOX_RESULT_PATH",
    formatEnvVar: "MACBOX_RESULT_FORMAT",
    defaultFormat: "json",
    notes:
      "If you want your skill to return structured output, write JSON to $MACBOX_RESULT_PATH. macbox can emit a machine-readable envelope via: `macbox skills run <name> --json -- ...`.",
  },
};

export const formatContractText = (c: SkillsContractV1 = skillsContractV1): string => {
  const lines: string[] = [];
  lines.push("macbox skill contract v1");
  lines.push("");
  lines.push("Injected env vars:");
  for (const v of c.env) lines.push(`- ${v.name}: ${v.description}`);
  lines.push("");
  lines.push("Structured result (optional):");
  lines.push(`- ${c.resultFile.envVar}: path to write JSON result`);
  lines.push(`- ${c.resultFile.formatEnvVar}: defaults to '${c.resultFile.defaultFormat}'`);
  lines.push(`- Notes: ${c.resultFile.notes}`);
  return lines.join("\n");
};
