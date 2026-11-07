// Builds the three prompts a page hands to ConnectPanel, from the server's own configuration (batch 058). Server only.
import type { PanelPrompt } from "@/components/ai/ConnectPanel";
import { buildSetupPrompt, CLIENT_LABEL, CLIENTS } from "@/lib/ai-connect";
import type { AiConnectConfig } from "@/lib/ai-config";

export function panelPrompts(config: AiConnectConfig): { prompts: PanelPrompt[]; reason: string | null } {
  const results = CLIENTS.map((client) => ({ client, result: buildSetupPrompt({ client, setupUrl: config.setupUrl, mcpUrl: config.available ? config.mcpUrl : null }) }));
  const failed = results.find((r) => !r.result.ok);
  return {
    prompts: results.map(({ client, result }) => ({ client, label: CLIENT_LABEL[client], prompt: result.ok ? result.prompt : null })),
    reason: failed && !failed.result.ok ? failed.result.reason : null,
  };
}
