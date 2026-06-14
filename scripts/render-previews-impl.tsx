// Renders ethagent's TUI screens into preview/*.svg using the real Ink
// components and fake (layout-only) data, so the README shows the actual app.
// Mirrors IdentityManager.tsx's chrome (the Wordmark on top of each screen) at
// a fixed column width, captures the ANSI frame with ink-testing-library, and
// paints it as a terminal window via ansiToSvg.
//
//   image.svg  – the first-run panel (the README hero), in a terminal window
//   menu.svg   – the main menu, in a terminal window
//   skills.svg – the skills catalog, in a terminal window
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { theme } from "../src/ui/theme.js";
import { Wordmark } from "../src/identity/manager/shared/components/Wordmark.js";
import { MenuScreen } from "../src/identity/manager/shared/components/MenuScreen.js";
import { SkillsTreeScreen } from "../src/identity/manager/continuity/skills/SkillsTreeScreen.js";
import { ansiToSvg, type AnsiToSvgOptions } from "./ansi-to-svg.js";
import { fakeIdentity, fakeConfig, cleanReconciliation, fakeSkillsTree } from "./fake-data.js";

const COLS = 80; // soundcli-style width (832px)
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "preview");
mkdirSync(OUT_DIR, { recursive: true });

const noop = () => {};
const footer = <Text color={theme.dim}>↵ select · esc back</Text>;

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

// Wordmark on top of a screen, centered, exactly like IdentityManager.tsx.
const withChrome = (screen: React.ReactNode): React.ReactNode => (
  <Box flexDirection="column" alignItems="center" width={COLS}>
    <Wordmark />
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

// 1. Hero: the first run panel, in a terminal window, same format as the other screens.
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

// 2. Main menu: a linked identity, the full set of actions + status line.
save(
  "menu",
  withChrome(
    <MenuScreen
      config={fakeConfig}
      identity={fakeIdentity}
      reconciliation={cleanReconciliation}
      workingStatus={null}
      canRebackup={true}
      {...menuCallbacks}
    />,
  ),
  { solidBlocks: true },
);

// 3. Skills: the catalog of public and private skills (sample tree).
save(
  "skills",
  withChrome(
    <SkillsTreeScreen
      identity={fakeIdentity}
      config={fakeConfig}
      workingStatus={null}
      initialTree={fakeSkillsTree}
      footer={footer}
      onOpenSkill={noop}
      onOpenFolder={noop}
      onBack={noop}
    />,
  ),
  { solidBlocks: true },
);
