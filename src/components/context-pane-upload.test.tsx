// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextPaneProvider, SidePane } from "./context-pane";
import { FileUploadPage } from "../routes/-file-upload";

const operations = vi.hoisted(() => ({
  startArtifactUpload: vi.fn(),
  confirmArtifactUpload: vi.fn(),
}));
vi.mock("../server/operations", () => operations);
vi.mock("../browser/crypto", () => ({
  sha256Base64: async () => "synthetic-checksum",
}));

const originalFileArrayBuffer = Object.getOwnPropertyDescriptor(
  File.prototype,
  "arrayBuffer",
);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new TextEncoder().encode("%PDF-1.7\nsynthetic").buffer,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalFileArrayBuffer)
    Object.defineProperty(
      File.prototype,
      "arrayBuffer",
      originalFileArrayBuffer,
    );
  else delete (File.prototype as Partial<File>).arrayBuffer;
});

const UploadFixture = () => {
  const [open, setOpen] = useState(true);
  return (
    <>
      <h1>Source workspace</h1>
      <SidePane title="Upload" isOpen={open} onClose={() => setOpen(false)}>
        <FileUploadPage
          embedded
          session={{ authenticated: true, user: { id: "synthetic-actor" } }}
        />
      </SidePane>
    </>
  );
};

const setupUpload = async () => {
  const root = createRootRoute({
    component: () => (
      <ContextPaneProvider>
        <UploadFixture />
      </ContextPaneProvider>
    ),
  });
  const source = createRoute({
    getParentRoute: () => root,
    path: "/workspace",
  });
  const router = createRouter({
    routeTree: root.addChildren([source]),
    history: createMemoryHistory({ initialEntries: ["/workspace"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  fireEvent.change(await screen.findByLabelText("File", { exact: true }), {
    target: {
      files: [
        new File(["%PDF-1.7"], "synthetic.pdf", { type: "application/pdf" }),
      ],
    },
  });
};

describe("upload pane guard lifecycle", () => {
  it("preserves file and metadata when dirty dismissal is cancelled", async () => {
    await setupUpload();
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "retain metadata" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Upload" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Filename") as HTMLInputElement).value).toBe(
      "synthetic.pdf",
    );
    expect((screen.getByLabelText("Notes") as HTMLTextAreaElement).value).toBe(
      "retain metadata",
    );
  });

  it("blocks during an upload attempt and allows guarded dismissal after failure", async () => {
    let reject!: (reason: unknown) => void;
    operations.startArtifactUpload.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    await setupUpload();
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    await waitFor(() =>
      expect(operations.startArtifactUpload).toHaveBeenCalledOnce(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close Upload" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Upload" })).toBeTruthy();
    await act(async () => reject(new Error("synthetic start failure")));
    await screen.findByRole("button", { name: "Upload file" });
    fireEvent.click(screen.getByRole("button", { name: "Close Upload" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Upload" })).toBeNull(),
    );
  });
});
