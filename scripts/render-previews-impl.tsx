import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink-testing-library";
import { Box } from "ink";
import { Logo } from "../src/identity/manager/shared/components/Logo.js";
import { MenuScreen } from "../src/identity/manager/shared/components/MenuScreen.js";
import { ansiToSvg, type AnsiToSvgOptions } from "./ansi-to-svg.js";
import { previewIdentity, previewConfig, cleanReconciliation } from "./preview-data.js";

const COLS = 80;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "preview");
mkdirSync(OUT_DIR, { recursive: true });

const noop = () => {};

function save(name: string, node: React.ReactNode, opts: Partial<AnsiToSvgOptions> = {}): void {
  const { lastFrame, unmount } = render(node);
  const frame = lastFrame() ?? "";
  unmount();
  if (!/\x1b\[/.test(frame)) {
    throw new Error(`${name}: frame has no ANSI colors (FORCE_COLOR didn't take)`);
  }
  const svg = ansiToSvg(frame, { cols: COLS, bg: "#030509", title: "ethagent", ...opts });
  writeFileSync(join(OUT_DIR, `${name}.svg`), svg);
  console.log(`preview/${name}.svg`);
}

const withChrome = (screen: React.ReactNode): React.ReactNode => (
  <Box flexDirection="column" alignItems="center" width={COLS}>
    <Logo />
    <Box flexDirection="column" marginTop={1} width="100%">
      {screen}
    </Box>
  </Box>
);

const menuCallbacks = {
  onCreate: noop,
  onLoad: noop,
  onBackupNow: noop,
  onRefetchLatest: noop,
  onPublicProfile: noop,
  onEnsName: noop,
  onWalletSetup: noop,
  onContinuity: noop,
  onSkillsTree: noop,
  onIdentityValues: noop,
  onPrepareTransfer: noop,
  onStorage: noop,
  onCancel: noop,
};

save(
  "image",
  withChrome(
    <MenuScreen
      config={undefined}
      identity={undefined}
      reconciliation={undefined}
      workingStatus={null}
      canRebackup={true}
      {...menuCallbacks}
    />,
  ),
  { solidBlocks: true },
);

save(
  "menu",
  withChrome(
    <MenuScreen
      config={previewConfig}
      identity={previewIdentity}
      reconciliation={cleanReconciliation}
      workingStatus={null}
      canRebackup={true}
      {...menuCallbacks}
    />,
  ),
  { solidBlocks: true },
);
