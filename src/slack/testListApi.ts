import { vi, type Mock } from "vitest";
import type { ListApi, ListInfo } from "./lists.js";

export type MockListApi = { [K in keyof ListApi]: Mock<ListApi[K]> };

/** Every `ListApi` member as a vitest mock typed from the real signature. Unprogrammed members
 *  return `undefined`. */
export function createListApiMock(): MockListApi {
  return {
    getListInfo: vi.fn<ListApi["getListInfo"]>(),
    listItems: vi.fn<ListApi["listItems"]>(),
    getItem: vi.fn<ListApi["getItem"]>(),
    createItem: vi.fn<ListApi["createItem"]>(),
    updateCells: vi.fn<ListApi["updateCells"]>(),
    deleteItems: vi.fn<ListApi["deleteItems"]>(),
    createList: vi.fn<ListApi["createList"]>(),
    shareListWithChannel: vi.fn<ListApi["shareListWithChannel"]>(),
    isDirectConversation: vi.fn<ListApi["isDirectConversation"]>(),
  };
}

/** A "Tasks" List (`F0LIST123`) with Title (primary text), Status (select Todo/Done), Owner
 *  (user) and Due (date) columns. A fresh object per call. */
export function createTasksListInfo(): ListInfo {
  return {
    id: "F0LIST123",
    title: "Tasks",
    permalink: "https://acme.slack.com/lists/T0123/F0LIST123",
    columns: [
      { id: "Col1", key: "title", name: "Title", type: "text", isPrimary: true, choices: [] },
      {
        id: "Col2",
        key: "status",
        name: "Status",
        type: "select",
        isPrimary: false,
        choices: [
          { value: "todo", label: "Todo" },
          { value: "done", label: "Done" },
        ],
      },
      { id: "Col3", key: "owner", name: "Owner", type: "user", isPrimary: false, choices: [] },
      { id: "Col4", key: "due", name: "Due", type: "date", isPrimary: false, choices: [] },
    ],
  };
}
