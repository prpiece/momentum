import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Switch } from "../../components/ui/Switch";
import { isTauri } from "../../db/client";
import { useSettingsDraft } from "../../stores/settingsDraft";
import { toast } from "../../stores/ui";

type CliInfo = { cliPath: string; link: string; onPath: boolean };

/** One copy-paste setup per agent. `cmd` is how it should call the CLI: `momentum` on PATH, else the absolute path. */
export function agentSnippets(cmd: string, absolute: string) {
  const server = (command: string) => JSON.stringify({ mcpServers: { momentum: { command, args: ["mcp"] } } }, null, 2);
  const q = cmd.includes(" ") ? `"${cmd}"` : cmd;
  return [
    { name: "Claude Code", where: "Run in a terminal", text: `claude mcp add momentum -- ${q} mcp` },
    { name: "Claude Desktop", where: "claude_desktop_config.json (Settings → Developer → Edit Config)", text: server(absolute || cmd) },
    { name: "Cursor", where: "~/.cursor/mcp.json", text: server(cmd) },
    { name: "Codex", where: "~/.codex/config.toml", text: `[mcp_servers.momentum]\ncommand = '${cmd}'\nargs = ["mcp"]` },
    { name: "Gemini CLI", where: "~/.gemini/settings.json", text: server(cmd) },
  ];
}

function Snippet({ name, where, text }: { name: string; where: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast("Couldn't copy; select the text and copy it."),
    );
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-sm)] font-medium">{name}</div>
          <div className="truncate text-[length:var(--fs-xs)] text-muted">{where}</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-control bg-surface-2 px-3 py-2 font-[inherit] text-[length:var(--fs-xs)]">{text}</pre>
    </div>
  );
}

/** Settings → AI agents: put `momentum` on PATH and set up an agent (D264). */
// Track C moves this to Connections (D258).
export function AgentsPanel() {
  const { draft, update } = useSettingsDraft();
  const [info, setInfo] = useState<CliInfo | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<CliInfo>("agent_cli_info")).then(setInfo, () => undefined);
  }, []);

  if (!isTauri) return <p className="text-sm text-muted">AI agents connect to the desktop app.</p>;
  const snippets = agentSnippets(draft.cliOnPath ? "momentum" : info?.cliPath || "momentum", info?.cliPath ?? "");
  return (
    <div className="space-y-4">
      <p className="text-[length:var(--fs-sm)] text-muted">
        Your own AI agent can read and change your tasks through Momentum while it runs. Nothing leaves this computer: the app listens on a private local port and a token only you can read. If Momentum is closed, the command starts it in the tray.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">Add <code>momentum</code> to PATH</div>
          <div className="text-[length:var(--fs-xs)] text-muted">{draft.cliOnPath ? `Installed at ${info?.link ?? ""}.` : "Lets you run momentum add \"call mom by fri\" in any terminal."} Setting is per device.</div>
        </div>
        <Switch checked={draft.cliOnPath} onChange={(v) => update({ cliOnPath: v })} label="Add momentum to PATH" />
      </div>
      {info && !info.cliPath && <p className="text-[length:var(--fs-xs)] text-danger">The command line tool isn&apos;t installed next to this build of the app.</p>}
      <div className="space-y-4">
        {snippets.map((s) => (
          <Snippet key={s.name} {...s} />
        ))}
      </div>
    </div>
  );
}
