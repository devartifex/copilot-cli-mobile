import type {
  SessionMode,
  ReasoningEffort,
  PersistedSettings,
  CustomToolDefinition,
  CustomAgentDefinition,
  McpServerDefinition,
  SkillDefinition,
  InfiniteSessionsSettings,
  ProviderDefinition,
} from '$lib/types/index.js';

const STORAGE_KEY = 'copilot-cli-settings';

const DEFAULT_INFINITE_SESSIONS: InfiniteSessionsSettings = {
  enabled: true,
  backgroundThreshold: 0.80,
  bufferThreshold: 0.95,
};

const DEFAULT_SETTINGS: PersistedSettings = {
  model: '',
  mode: 'interactive',
  reasoningEffort: 'medium',
  customInstructions: '',
  excludedTools: [],
  customTools: [],
  customAgents: [],
  mcpServers: [],
  disabledSkills: [],
  infiniteSessions: { ...DEFAULT_INFINITE_SESSIONS },
};

const VALID_MODES = new Set<SessionMode>(['interactive', 'plan', 'autopilot']);
const VALID_REASONING = new Set<ReasoningEffort>(['low', 'medium', 'high', 'xhigh']);

function isValidCustomTool(t: unknown): t is CustomToolDefinition {
  if (!t || typeof t !== 'object') return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.webhookUrl === 'string' &&
    (obj.method === 'GET' || obj.method === 'POST') &&
    typeof obj.headers === 'object' && obj.headers !== null &&
    typeof obj.parameters === 'object' && obj.parameters !== null
  );
}

function isValidCustomAgent(agent: unknown): agent is CustomAgentDefinition {
  if (!agent || typeof agent !== 'object') return false;
  const obj = agent as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    (typeof obj.displayName === 'undefined' || typeof obj.displayName === 'string') &&
    (typeof obj.description === 'undefined' || typeof obj.description === 'string') &&
    (typeof obj.tools === 'undefined' || (Array.isArray(obj.tools) && obj.tools.every((tool) => typeof tool === 'string'))) &&
    typeof obj.prompt === 'string'
  );
}

function isValidMcpServer(s: unknown): s is McpServerDefinition {
  if (!s || typeof s !== 'object') return false;
  const obj = s as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    typeof obj.url === 'string' &&
    (obj.type === 'http' || obj.type === 'sse') &&
    typeof obj.headers === 'object' && obj.headers !== null &&
    Array.isArray(obj.tools) &&
    typeof obj.enabled === 'boolean'
  );
}

const VALID_PROVIDER_TYPES = new Set(['openai', 'azure', 'anthropic']);
const VALID_WIRE_APIS = new Set(['completions', 'responses']);

function isValidProvider(p: unknown): p is ProviderDefinition {
  if (!p || typeof p !== 'object') return false;
  const obj = p as Record<string, unknown>;
  if (typeof obj.baseUrl !== 'string' || !obj.baseUrl) return false;
  if (obj.apiKey !== undefined && typeof obj.apiKey !== 'string') return false;
  if (obj.bearerToken !== undefined && typeof obj.bearerToken !== 'string') return false;
  if (obj.type !== undefined && (typeof obj.type !== 'string' || !VALID_PROVIDER_TYPES.has(obj.type))) return false;
  if (obj.wireApi !== undefined && (typeof obj.wireApi !== 'string' || !VALID_WIRE_APIS.has(obj.wireApi))) return false;
  if (obj.azureApiVersion !== undefined && typeof obj.azureApiVersion !== 'string') return false;
  return true;
}

export interface SettingsStore {
  customInstructions: string;
  excludedTools: string[];
  customTools: CustomToolDefinition[];
  customAgents: CustomAgentDefinition[];
  reasoningEffort: ReasoningEffort;
  selectedModel: string;
  selectedMode: SessionMode;
  mcpServers: McpServerDefinition[];
  disabledSkills: string[];
  availableSkills: SkillDefinition[];
  infiniteSessions: InfiniteSessionsSettings;
  provider: ProviderDefinition | undefined;
  load(): void;
  save(): void;
  syncFromServer(): Promise<void>;
  fetchSkills(): Promise<void>;
}

export function createSettingsStore(): SettingsStore {
  let customInstructions = $state(DEFAULT_SETTINGS.customInstructions);
  let excludedTools = $state<string[]>([...DEFAULT_SETTINGS.excludedTools]);
  let customTools = $state<CustomToolDefinition[]>([...DEFAULT_SETTINGS.customTools]);
  let customAgents = $state<CustomAgentDefinition[]>([...(DEFAULT_SETTINGS.customAgents ?? [])]);
  let reasoningEffort = $state<ReasoningEffort>(DEFAULT_SETTINGS.reasoningEffort);
  let selectedModel = $state(DEFAULT_SETTINGS.model);
  let selectedMode = $state<SessionMode>(DEFAULT_SETTINGS.mode);
  let mcpServers = $state<McpServerDefinition[]>([...(DEFAULT_SETTINGS.mcpServers ?? [])]);
  let disabledSkills = $state<string[]>([...(DEFAULT_SETTINGS.disabledSkills ?? [])]);
  let availableSkills = $state<SkillDefinition[]>([]);
  let infiniteSessions = $state<InfiniteSessionsSettings>({ ...DEFAULT_INFINITE_SESSIONS });
  let provider = $state<ProviderDefinition | undefined>(undefined);

  function load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      applySettings(parsed);
    } catch {
      // Ignore corrupt data
    }
  }

  function getCurrentData(): PersistedSettings {
    return {
      model: selectedModel,
      mode: selectedMode,
      reasoningEffort,
      customInstructions,
      excludedTools,
      customTools,
      customAgents,
      mcpServers,
      disabledSkills,
      infiniteSessions,
    };
  }

  function applySettings(parsed: Partial<PersistedSettings>): void {
    if (parsed.model && typeof parsed.model === 'string') {
      selectedModel = parsed.model;
    }
    // Mode is intentionally not restored — always defaults to 'interactive' (Ask)
    if (parsed.reasoningEffort && VALID_REASONING.has(parsed.reasoningEffort as ReasoningEffort)) {
      reasoningEffort = parsed.reasoningEffort as ReasoningEffort;
    }
    if (typeof parsed.customInstructions === 'string') {
      customInstructions = parsed.customInstructions;
    }
    if (Array.isArray(parsed.excludedTools)) {
      excludedTools = parsed.excludedTools.filter((t): t is string => typeof t === 'string');
    }
    if (Array.isArray(parsed.customTools)) {
      customTools = parsed.customTools.filter(isValidCustomTool).slice(0, 10);
    }
    if (Array.isArray(parsed.customAgents)) {
      customAgents = parsed.customAgents.filter(isValidCustomAgent).slice(0, 10);
    }
    if (Array.isArray(parsed.mcpServers)) {
      mcpServers = parsed.mcpServers.filter(isValidMcpServer).slice(0, 10);
    }
    if (Array.isArray(parsed.disabledSkills)) {
      disabledSkills = parsed.disabledSkills.filter((s): s is string => typeof s === 'string');
    }
    if (parsed.infiniteSessions && typeof parsed.infiniteSessions === 'object') {
      const inf = parsed.infiniteSessions;
      infiniteSessions = {
        enabled: inf.enabled !== false,
        backgroundThreshold: typeof inf.backgroundThreshold === 'number'
          ? Math.max(0, Math.min(1, inf.backgroundThreshold))
          : DEFAULT_INFINITE_SESSIONS.backgroundThreshold,
        bufferThreshold: typeof inf.bufferThreshold === 'number'
          ? Math.max(0, Math.min(1, inf.bufferThreshold))
          : DEFAULT_INFINITE_SESSIONS.bufferThreshold,
      };
    }
  }

  function save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getCurrentData()));
    } catch {
      // Ignore quota errors
    }
    // Fire-and-forget sync to server
    syncToServer();
  }

  function syncToServer(): void {
    try {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: getCurrentData() }),
      }).catch(() => { /* ignore network errors */ });
    } catch {
      // Ignore errors
    }
  }

  async function syncFromServer(): Promise<void> {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const body = await res.json() as { settings?: PersistedSettings | null };
      if (body.settings) {
        applySettings(body.settings);
        // Update localStorage with server data
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(getCurrentData()));
        }
      } else {
        // No server data yet — push current local settings to server
        syncToServer();
      }
    } catch {
      // Ignore fetch errors — use local data
    }
  }

  async function fetchSkills(): Promise<void> {
    try {
      const res = await fetch('/api/skills');
      if (!res.ok) return;
      const body = await res.json() as { skills?: SkillDefinition[] };
      if (Array.isArray(body.skills)) {
        availableSkills = body.skills;
      }
    } catch {
      // Ignore fetch errors
    }
  }

  return {
    get customInstructions() { return customInstructions; },
    set customInstructions(v: string) { customInstructions = v; save(); },

    get excludedTools() { return excludedTools; },
    set excludedTools(v: string[]) { excludedTools = v; save(); },

    get customTools() { return customTools; },
    set customTools(v: CustomToolDefinition[]) { customTools = v.slice(0, 10); save(); },

    get customAgents() { return customAgents; },
    set customAgents(v: CustomAgentDefinition[]) { customAgents = v.slice(0, 10); save(); },

    get reasoningEffort() { return reasoningEffort; },
    set reasoningEffort(v: ReasoningEffort) { reasoningEffort = v; save(); },

    get selectedModel() { return selectedModel; },
    set selectedModel(v: string) { selectedModel = v; save(); },

    get selectedMode() { return selectedMode; },
    set selectedMode(v: SessionMode) { selectedMode = v; save(); },

    get mcpServers() { return mcpServers; },
    set mcpServers(v: McpServerDefinition[]) { mcpServers = v.slice(0, 10); save(); },

    get disabledSkills() { return disabledSkills; },
    set disabledSkills(v: string[]) { disabledSkills = v; save(); },

    get availableSkills() { return availableSkills; },
    set availableSkills(v: SkillDefinition[]) { availableSkills = v; },

    get infiniteSessions() { return infiniteSessions; },
    set infiniteSessions(v: InfiniteSessionsSettings) {
      infiniteSessions = {
        enabled: v.enabled,
        backgroundThreshold: Math.max(0, Math.min(1, v.backgroundThreshold)),
        bufferThreshold: Math.max(0, Math.min(1, v.bufferThreshold)),
      };
      save();
    },

    load,
    save,
    syncFromServer,
    fetchSkills,
  };
}
