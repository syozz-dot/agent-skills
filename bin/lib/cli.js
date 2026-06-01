// bin/lib/cli.js — argument parsing + colored output helpers.
// Pure stdlib, no dependencies.

const COLORS = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  red:   '\x1b[31m',
  green: '\x1b[32m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
};

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (color, s) => (tty ? `${COLORS[color]}${s}${COLORS.reset}` : s);

export const fmt = {
  ok:   (s) => c('green',  s),
  warn: (s) => c('yellow', s),
  err:  (s) => c('red',    s),
  hint: (s) => c('cyan',   s),
  dim:  (s) => c('dim',    s),
  bold: (s) => c('bold',   s),
};

export function die(msg, code = 1) {
  console.error(fmt.err('Error: ') + msg);
  process.exit(code);
}

/**
 * Parse `argv` (post-node, post-script). Recognized commands:
 *   install | uninstall | info | help | version
 * Recognized flags:
 *   --target <name>      (default: cursor)
 *   --install-dir <path> (overrides target's default install dir)
 *   --force              (proceed even if conflicts detected)
 *   --json               (machine-readable output where applicable)
 *   -h, --help           (alias for `help`)
 *   -v, --version        (alias for `version`)
 */
export function parseArgs(argv) {
  const args = [...argv];
  const out = {
    command: null,
    target: 'cursor',
    // Note: undefined (not null) so target modules' default-parameter
    // values kick in when the user doesn't pass --install-dir.
    installDir: undefined,
    force: false,
    json: false,
  };

  // Pull off flags first; whatever positional remains becomes the command.
  const positional = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--target')           out.target = args.shift();
    else if (a === '--install-dir') out.installDir = args.shift();
    else if (a === '--force')       out.force = true;
    else if (a === '--json')        out.json = true;
    else if (a === '-h' || a === '--help')    out.command = 'help';
    else if (a === '-v' || a === '--version') out.command = 'version';
    else if (a.startsWith('--')) {
      die(`Unknown flag: ${a}. Run 'trtc-agent-skills --help' for usage.`);
    } else {
      positional.push(a);
    }
  }

  if (!out.command) out.command = positional[0] || 'help';
  return out;
}

export const HELP_TEXT = `${fmt.bold('trtc-agent-skills')} — TRTC Agent Skills installer

${fmt.bold('Usage:')}
  npx @tencent-rtc/agent-skills <command> [options]

${fmt.bold('Commands:')}
  install              Install skills + hooks into the target IDE
  uninstall            Remove a previously installed copy
  info                 Show install location and version
  help                 Show this help (default)
  version              Show installer version

${fmt.bold('Options:')}
  --target <name>      Target IDE: cursor (default).
                       claude-code, codex, codebuddy reserved for v2.
  --install-dir <path> Override the default install directory
  --force              Proceed even if a conflicting install is detected
  --json               Machine-readable output (info command)

${fmt.bold('Examples:')}
  npx @tencent-rtc/agent-skills install
  npx @tencent-rtc/agent-skills install --target cursor --force
  npx @tencent-rtc/agent-skills uninstall
  npx @tencent-rtc/agent-skills info --json
`;
