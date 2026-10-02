import { vi, type Mock } from "vitest";
import type { CanvasApi } from "./canvases.js";

/**
 * The canonical `CanvasApi` fake: every member a vitest mock typed from the real function, so
 * arguments and return values are checked against the signature the canvas tools call.
 *
 * A test programs the calls its claim depends on and ignores the rest:
 *
 *     const api = createCanvasApiMock();
 *     api.getCanvasMarkdown.mockResolvedValue("# Title");
 *     ...
 *     expect(api.getCanvasMarkdown).toHaveBeenCalledWith(client, "F0456ABC");
 *
 * Unprogrammed members return `undefined`.
 */
export type MockCanvasApi = { [K in keyof CanvasApi]: Mock<CanvasApi[K]> };

/** Every `CanvasApi` member as a vitest mock typed from the real signature. */
export function createCanvasApiMock(): MockCanvasApi {
  return {
    getCanvasMarkdown: vi.fn<CanvasApi["getCanvasMarkdown"]>(),
    createCanvas: vi.fn<CanvasApi["createCanvas"]>(),
    shareCanvasWithChannel: vi.fn<CanvasApi["shareCanvasWithChannel"]>(),
    isDirectConversation: vi.fn<CanvasApi["isDirectConversation"]>(),
    findSections: vi.fn<CanvasApi["findSections"]>(),
    editCanvas: vi.fn<CanvasApi["editCanvas"]>(),
    canvasPermalink: vi.fn<CanvasApi["canvasPermalink"]>(),
  };
}

/** An error shaped like the ones `@slack/web-api` throws for an API error code. */
export function slackError(code: string): Error {
  return Object.assign(new Error(code), { data: { error: code } });
}
