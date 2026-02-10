import { boolFlag } from "./flags.ts";

type FlagValue = string | boolean | undefined;

const isSet = (v: FlagValue): boolean => v !== undefined;

export const resolveNetworkCapability = (args: {
  readonly allowNetwork: FlagValue;
  readonly blockNetwork: FlagValue;
  readonly noNetwork: FlagValue;
  readonly dflt: boolean;
}): boolean => {
  const allowSet = isSet(args.allowNetwork);
  const blockSet = isSet(args.blockNetwork);
  const noSet = isSet(args.noNetwork);

  if (allowSet && (blockSet || noSet)) {
    throw new Error(
      "macbox: use either --allow-network or --block-network/--no-network, not both",
    );
  }

  if (!allowSet && !blockSet && !noSet) return args.dflt;

  return boolFlag(args.allowNetwork, true) &&
    !boolFlag(args.blockNetwork, false) &&
    !boolFlag(args.noNetwork, false);
};

export const resolveExecCapability = (args: {
  readonly allowExec: FlagValue;
  readonly blockExec: FlagValue;
  readonly dflt: boolean;
}): boolean => {
  const allowSet = isSet(args.allowExec);
  const blockSet = isSet(args.blockExec);

  if (allowSet && blockSet) {
    throw new Error(
      "macbox: use either --allow-exec or --block-exec, not both",
    );
  }

  if (!allowSet && !blockSet) return args.dflt;

  return boolFlag(args.allowExec, true) && !boolFlag(args.blockExec, false);
};
