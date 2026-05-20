import { describe, it, mock, beforeEach } from "node:test";
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

const mockStart = mock.fn(async () => {});
const mockStop = mock.fn(async () => {});
const mockClient = { token: "mock-client" };

const mockAppInstance = {
  start: mockStart,
  stop: mockStop,
  client: mockClient,
  event: mock.fn(),
  action: mock.fn(),
  view: mock.fn(),
  command: mock.fn(),
  message: mock.fn(),
};

const MockAppConstructor = mock.fn(function (_config: AppConstructorConfig) {
  return mockAppInstance;
});

const mockGetConfig = mock.fn(() => ({
  slack: {
    botToken: "xoxb-test-bot-token",
    appToken: "xapp-test-app-token",
    signingSecret: "test-signing-secret",
  },
}));

const mockLogger = {
  info: mock.fn(() => {}),
  warn: mock.fn(() => {}),
  error: mock.fn(() => {}),
  debug: mock.fn(() => {}),
  startup: mock.fn(() => {}),
};

const mockRegisterHomeTabHandler = mock.fn(() => {});
const mockRegisterNewQueryHandler = mock.fn(() => {});
const mockRegisterRetryHandler = mock.fn(() => {});
const mockRegisterResendHandler = mock.fn(() => {});
const mockRegisterAssistant = mock.fn(() => {});
const mockRegisterMentionHandler = mock.fn(() => {});
const mockRegisterChoiceHandler = mock.fn(() => {});
const mockRegisterFollowupHandler = mock.fn(() => {});
const mockRegisterChangeActionHandler = mock.fn(() => {});
const mockRegisterConfigUpdateActionHandler = mock.fn(() => {});
const mockRegisterChangeThreadActionHandlers = mock.fn(() => {});
const mockRegisterDmActionHandlers = mock.fn(() => {});
const mockRegisterMessageChangedHandler = mock.fn(() => {});
const mockRegisterAutoRespondHandler = mock.fn(() => {});
const mockRegisterStopReactionHandler = mock.fn(() => {});

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
    registerMentionHandler: mockRegisterMentionHandler,
    registerChoiceHandler: mockRegisterChoiceHandler,
    registerFollowupHandler: mockRegisterFollowupHandler,
    registerChangeActionHandler: mockRegisterChangeActionHandler,
    registerConfigUpdateActionHandler: mockRegisterConfigUpdateActionHandler,
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
  mockRegisterHomeTabHandler.mock.resetCalls();
  mockRegisterNewQueryHandler.mock.resetCalls();
  mockRegisterRetryHandler.mock.resetCalls();
  mockRegisterResendHandler.mock.resetCalls();
  mockRegisterAssistant.mock.resetCalls();
  mockRegisterMentionHandler.mock.resetCalls();
  mockRegisterChoiceHandler.mock.resetCalls();
  mockRegisterFollowupHandler.mock.resetCalls();
  mockRegisterChangeActionHandler.mock.resetCalls();
  mockRegisterConfigUpdateActionHandler.mock.resetCalls();
  mockRegisterChangeThreadActionHandlers.mock.resetCalls();
  mockRegisterDmActionHandlers.mock.resetCalls();
  mockRegisterMessageChangedHandler.mock.resetCalls();
  mockRegisterAutoRespondHandler.mock.resetCalls();
  MockAppConstructor.mock.resetCalls();
  mockStart.mock.resetCalls();
  mockStop.mock.resetCalls();
  mockGetConfig.mock.resetCalls();
  mockLogger.info.mock.resetCalls();
  mockLogger.debug.mock.resetCalls();
  mockAppInstance.action.mock.resetCalls();
  mockAppInstance.view.mock.resetCalls();
}

function getConstructorConfig(): AppConstructorConfig {
  const arg = MockAppConstructor.mock.calls[0].arguments[0];
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

    assert.equal(MockAppConstructor.mock.callCount(), 1);
    const ctorConfig = getConstructorConfig();
    assert.equal(ctorConfig.token, "xoxb-test-bot-token");
    assert.equal(ctorConfig.appToken, "xapp-test-app-token");
    assert.equal(ctorConfig.signingSecret, "test-signing-secret");
    assert.equal(ctorConfig.socketMode, true);
  });

  it("always registers core handlers", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterHomeTabHandler.mock.callCount(), 1);
    assert.equal(mockRegisterNewQueryHandler.mock.callCount(), 1);
    assert.equal(mockRegisterRetryHandler.mock.callCount(), 1);
    assert.equal(mockRegisterResendHandler.mock.callCount(), 1);
    assert.equal(mockRegisterChoiceHandler.mock.callCount(), 1);
    assert.equal(mockRegisterFollowupHandler.mock.callCount(), 1);
    assert.equal(mockRegisterChangeActionHandler.mock.callCount(), 1);
    assert.equal(mockRegisterConfigUpdateActionHandler.mock.callCount(), 1);
    assert.equal(mockRegisterChangeThreadActionHandlers.mock.callCount(), 1);
    assert.equal(mockRegisterDmActionHandlers.mock.callCount(), 1);
  });

  it("always registers assistant handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterAssistant.mock.callCount(), 1);
  });

  it("always registers mention handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterMentionHandler.mock.callCount(), 1);
  });

  it("installs a single wildcard plugin-interactivity listener for actions and views", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    // The wildcard listener uses /^plugin:/. Find it among the recorded action() calls.
    const actionCalls = mockAppInstance.action.mock.calls;
    const pluginActionCalls = actionCalls.filter((c) => {
      const matcher = c.arguments[0];
      return matcher instanceof RegExp && matcher.source === "^plugin:";
    });
    assert.equal(pluginActionCalls.length, 1, "exactly one wildcard plugin action listener");

    const viewCalls = mockAppInstance.view.mock.calls;
    const pluginViewCalls = viewCalls.filter((c) => {
      const matcher = c.arguments[0];
      return matcher instanceof RegExp && matcher.source === "^plugin:";
    });
    assert.equal(pluginViewCalls.length, 1, "exactly one wildcard plugin view listener");
  });

  it("always registers messageChanged handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterMessageChangedHandler.mock.callCount(), 1);
  });

  it("always registers autoRespond handler", () => {
    const deps = makeDeps();
    createSlackApp(deps);

    assert.equal(mockRegisterAutoRespondHandler.mock.callCount(), 1);
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

    assert.equal(mockStart.mock.callCount(), 1);
  });

  it("logs when app starts", async () => {
    const deps = makeDeps();
    createSlackApp(deps);
    await startSlackApp(deps);

    assert.equal(mockLogger.info.mock.callCount(), 1);
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

    assert.equal(mockStop.mock.callCount(), 1);
  });

  it("logs when app stops", async () => {
    const deps = makeDeps();
    createSlackApp(deps);
    await stopSlackApp(deps);

    assert.equal(mockLogger.debug.mock.callCount(), 1);
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
