import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createSlackApp,
  startSlackApp,
  stopSlackApp,
  getSlackClient,
  type AppDeps,
} from "./app.js";

interface AppConstructorConfig {
  token: string;
  appToken: string;
  signingSecret: string;
  socketMode: boolean;
}

// ============================================================================
// Mocks
// ============================================================================

const mockStart = vi.fn(async () => {});
const mockStop = vi.fn(async () => {});
const mockClient = { token: "mock-client" };

const mockAppInstance = {
  start: mockStart,
  stop: mockStop,
  client: mockClient,
  event: vi.fn(),
  action: vi.fn(),
  view: vi.fn(),
  command: vi.fn(),
  message: vi.fn(),
};

const MockAppConstructor = vi.fn(function (_config: AppConstructorConfig) {
  return mockAppInstance;
});

type MockedConfig = {
  slack: { botToken: string; appToken: string; signingSecret: string };
  directMessages: { enabled: boolean; dmType: "assistant" | "classic" };
};

const mockGetConfig = vi.fn<() => MockedConfig>(() => ({
  slack: {
    botToken: "xoxb-test-bot-token",
    appToken: "xapp-test-app-token",
    signingSecret: "test-signing-secret",
  },
  directMessages: {
    enabled: true,
    dmType: "assistant",
  },
}));

const mockLogger = {
  info: vi.fn(() => {}),
  warn: vi.fn(() => {}),
  error: vi.fn(() => {}),
  debug: vi.fn(() => {}),
  startup: vi.fn(() => {}),
};

const mockRegisterHomeTabHandler = vi.fn(() => {});
const mockRegisterNewQueryHandler = vi.fn(() => {});
const mockRegisterRetryHandler = vi.fn(() => {});
const mockRegisterResendHandler = vi.fn(() => {});
const mockRegisterAssistant = vi.fn(() => {});
const mockRegisterClassicDmHandlers = vi.fn(() => {});
const mockRegisterMentionHandler = vi.fn(() => {});
const mockRegisterChoiceHandler = vi.fn(() => {});
const mockRegisterFollowupHandler = vi.fn(() => {});
const mockRegisterChangeActionHandler = vi.fn(() => {});
const mockRegisterConfigUpdateActionHandler = vi.fn(() => {});
const mockRegisterSkillActionHandler = vi.fn(() => {});
const mockRegisterUserSkillsHomeActions = vi.fn(() => {});
const mockRegisterChangeThreadActionHandlers = vi.fn(() => {});
const mockRegisterDmActionHandlers = vi.fn(() => {});
const mockRegisterMessageChangedHandler = vi.fn(() => {});
const mockRegisterAutoRespondHandler = vi.fn(() => {});
const mockRegisterStopReactionHandler = vi.fn(() => {});

function makeDeps(): AppDeps {
  return {
    App: MockAppConstructor as object as AppDeps["App"],
    getConfig: mockGetConfig as () => void as AppDeps["getConfig"],
    logger: mockLogger,
    registerNewQueryHandler: mockRegisterNewQueryHandler,
    registerRetryHandler: mockRegisterRetryHandler,
    registerResendHandler: mockRegisterResendHandler,
    registerHomeTabHandler: mockRegisterHomeTabHandler,
    registerAssistant: mockRegisterAssistant,
    registerClassicDmHandlers: mockRegisterClassicDmHandlers,
    registerMentionHandler: mockRegisterMentionHandler,
    registerChoiceHandler: mockRegisterChoiceHandler,
    registerFollowupHandler: mockRegisterFollowupHandler,
    registerChangeActionHandler: mockRegisterChangeActionHandler,
    registerConfigUpdateActionHandler: mockRegisterConfigUpdateActionHandler,
    registerSkillActionHandler: mockRegisterSkillActionHandler,
    registerUserSkillsHomeActions: mockRegisterUserSkillsHomeActions,
    registerChangeThreadActionHandlers: mockRegisterChangeThreadActionHandlers,
    registerDmActionHandlers: mockRegisterDmActionHandlers,
    registerMessageChangedHandler: mockRegisterMessageChangedHandler,
    registerAutoRespondHandler: mockRegisterAutoRespondHandler,
    registerStopReactionHandler: mockRegisterStopReactionHandler,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function resetAllMocks() {
  mockRegisterHomeTabHandler.mockClear();
  mockRegisterNewQueryHandler.mockClear();
  mockRegisterRetryHandler.mockClear();
  mockRegisterResendHandler.mockClear();
  mockRegisterAssistant.mockClear();
  mockRegisterClassicDmHandlers.mockClear();
  mockRegisterMentionHandler.mockClear();
  mockRegisterChoiceHandler.mockClear();
  mockRegisterFollowupHandler.mockClear();
  mockRegisterChangeActionHandler.mockClear();
  mockRegisterConfigUpdateActionHandler.mockClear();
  mockRegisterChangeThreadActionHandlers.mockClear();
  mockRegisterDmActionHandlers.mockClear();
  mockRegisterMessageChangedHandler.mockClear();
  mockRegisterAutoRespondHandler.mockClear();
  MockAppConstructor.mockClear();
  mockStart.mockClear();
  mockStop.mockClear();
  mockGetConfig.mockClear();
  mockLogger.info.mockClear();
  mockLogger.debug.mockClear();
  mockAppInstance.action.mockClear();
  mockAppInstance.view.mockClear();
}

function getConstructorConfig(): AppConstructorConfig {
  const arg = MockAppConstructor.mock.calls[0][0];
  if (typeof arg !== "object" || arg === null) {
    throw new Error("Constructor arg is not an object");
  }
  return arg as AppConstructorConfig;
}

// ============================================================================
// Tests
// ============================================================================

describe("createSlackApp", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("passes correct tokens to App constructor", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(MockAppConstructor.mock.calls.length, 1);
    const ctorConfig = getConstructorConfig();
    assert.equal(ctorConfig.token, "xoxb-test-bot-token");
    assert.equal(ctorConfig.appToken, "xapp-test-app-token");
    assert.equal(ctorConfig.signingSecret, "test-signing-secret");
    assert.equal(ctorConfig.socketMode, true);
  });

  it("always registers core handlers", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterHomeTabHandler.mock.calls.length, 1);
    assert.equal(mockRegisterNewQueryHandler.mock.calls.length, 1);
    assert.equal(mockRegisterRetryHandler.mock.calls.length, 1);
    assert.equal(mockRegisterResendHandler.mock.calls.length, 1);
    assert.equal(mockRegisterChoiceHandler.mock.calls.length, 1);
    assert.equal(mockRegisterFollowupHandler.mock.calls.length, 1);
    assert.equal(mockRegisterChangeActionHandler.mock.calls.length, 1);
    assert.equal(mockRegisterConfigUpdateActionHandler.mock.calls.length, 1);
    assert.equal(mockRegisterChangeThreadActionHandlers.mock.calls.length, 1);
    assert.equal(mockRegisterDmActionHandlers.mock.calls.length, 1);
  });

  it("registers assistant handler when dmType is assistant", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterAssistant.mock.calls.length, 1);
    assert.equal(mockRegisterClassicDmHandlers.mock.calls.length, 0);
  });

  it("registers classic DM handler when dmType is classic", () => {
    mockGetConfig.mockReturnValueOnce({
      slack: {
        botToken: "xoxb-test-bot-token",
        appToken: "xapp-test-app-token",
        signingSecret: "test-signing-secret",
      },
      directMessages: {
        enabled: true,
        dmType: "classic",
      },
    });
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterClassicDmHandlers.mock.calls.length, 1);
    assert.equal(mockRegisterAssistant.mock.calls.length, 0);
  });

  it("always registers mention handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterMentionHandler.mock.calls.length, 1);
  });

  it("installs a single wildcard plugin-interactivity listener for actions and views", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    // The wildcard listener uses /^plugin:/. Find it among the recorded action() calls.
    const actionCalls = mockAppInstance.action.mock.calls;
    const pluginActionCalls = actionCalls.filter((c) => {
      const matcher = c[0];
      return matcher instanceof RegExp && matcher.source === "^plugin:";
    });
    assert.equal(pluginActionCalls.length, 1, "exactly one wildcard plugin action listener");

    const viewCalls = mockAppInstance.view.mock.calls;
    const pluginViewCalls = viewCalls.filter((c) => {
      const matcher = c[0];
      return matcher instanceof RegExp && matcher.source === "^plugin:";
    });
    assert.equal(pluginViewCalls.length, 1, "exactly one wildcard plugin view listener");
  });

  it("always registers messageChanged handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterMessageChangedHandler.mock.calls.length, 1);
  });

  it("always registers autoRespond handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterAutoRespondHandler.mock.calls.length, 1);
  });
});

describe("startSlackApp", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls app.start()", async () => {
    const deps = makeDeps();
    createSlackApp(deps);
    await startSlackApp(deps);

    assert.equal(mockStart.mock.calls.length, 1);
  });

  it("logs when app starts", async () => {
    const deps = makeDeps();
    createSlackApp(deps);
    mockLogger.info.mockClear(); // ignore the boot-time "DM mode: ..." line
    await startSlackApp(deps);

    assert.equal(mockLogger.info.mock.calls.length, 1);
  });
});

describe("stopSlackApp", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("calls app.stop() when app exists", async () => {
    const deps = makeDeps();
    createSlackApp(deps);
    await stopSlackApp(deps);

    assert.equal(mockStop.mock.calls.length, 1);
  });

  it("logs when app stops", async () => {
    const deps = makeDeps();
    createSlackApp(deps);
    await stopSlackApp(deps);

    assert.equal(mockLogger.debug.mock.calls.length, 1);
  });
});

describe("getSlackClient", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it("returns client after createSlackApp", () => {
    const deps = makeDeps();
    createSlackApp(deps);
    const client = getSlackClient();

    assert.equal(client, mockClient);
  });
});
