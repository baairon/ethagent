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
import { previewIdentity, previewConfig, cleanReconciliation, previewSkillsTree } from "./preview-data.js";

const COLS = 80;
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

save(
  "skills",
  withChrome(
    <SkillsTreeScreen
      identity={previewIdentity}
      config={previewConfig}
      workingStatus={null}
      initialTree={previewSkillsTree}
      footer={footer}
      onOpenSkill={noop}
      onOpenFolder={noop}
      onBack={noop}
    />,
  ),
  { solidBlocks: true },
);
