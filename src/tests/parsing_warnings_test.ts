import { assert } from "./testutil.ts";
import { loadMacboxConfigWithWarnings } from "../config.ts";
import { validatePresetWithWarnings } from "../presets.ts";
import { loadProfilesOptional } from "../profiles.ts";

const withTempDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = await Deno.makeTempDir({ prefix: "macbox-parse-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
};

Deno.test("loadMacboxConfigWithWarnings reports unknown and invalid fields", async () => {
  await withTempDir(async (dir) => {
    const cfgPath = `${dir}/macbox.json`;
    await Deno.writeTextFile(
      cfgPath,
      JSON.stringify({
        schema: "macbox.config.v999",
        defaults: {
          agent: "invalid-agent",
          preset: "fullstack-typescript",
          profiles: ["host-tools"],
          extraThing: true,
        },
        flows: {},
      }),
    );

    const loaded = await loadMacboxConfigWithWarnings(dir, dir);
    assert(loaded !== null, "expected config to load");
    assert(
      loaded!.config.defaults?.agent === undefined,
      "invalid agent should be ignored",
    );
    assert(
      loaded!.warnings.some((w) => w.includes("unsupported schema")),
      "expected schema warning",
    );
    assert(
      loaded!.warnings.some((w) =>
        w.includes("unknown top-level field 'flows'")
      ),
      "expected unknown field warning",
    );
    assert(
      loaded!.warnings.some((w) => w.includes("defaults.agent")),
      "expected invalid agent warning",
    );
  });
});

Deno.test("validatePresetWithWarnings flags legacy and invalid preset fields", () => {
  const validated = validatePresetWithWarnings(
    {
      name: "x",
      agent: "bad-agent",
      model: "old-model",
      capabilities: {
        network: "yes",
        strange: true,
      },
      env: {
        OK: "1",
        BAD: 2,
      },
    },
    "x",
  );
  assert(
    validated.preset.agent === undefined,
    "invalid agent should be ignored",
  );
  assert(validated.preset.env?.OK === "1", "valid env key should be kept");
  assert(
    validated.warnings.some((w) => w.includes("legacy field 'model'")),
    "expected legacy model warning",
  );
  assert(
    validated.warnings.some((w) => w.includes("invalid agent")),
    "expected invalid agent warning",
  );
  assert(
    validated.warnings.some((w) =>
      w.includes("capabilities.network must be boolean")
    ),
    "expected capabilities type warning",
  );
});

Deno.test("loadProfilesOptional includes profile validation warnings", async () => {
  await withTempDir(async (dir) => {
    const profilePath = `${dir}/bad-profile.json`;
    await Deno.writeTextFile(
      profilePath,
      JSON.stringify({
        name: "bad-profile",
        read_paths: "not-an-array",
        mach_lookup: 123,
        legacy_field: true,
      }),
    );

    const loaded = await loadProfilesOptional(
      dir,
      [profilePath],
      new Set<string>(),
    );
    assert(loaded.profiles.length === 1, "expected one profile");
    assert(
      loaded.warnings.some((w) => w.includes("unknown field 'legacy_field'")),
      "expected unknown field warning",
    );
    assert(
      loaded.warnings.some((w) => w.includes("read_paths must be string[]")),
      "expected read_paths warning",
    );
    assert(
      loaded.warnings.some((w) =>
        w.includes("mach_lookup must be boolean or string[]")
      ),
      "expected mach_lookup warning",
    );
  });
});
