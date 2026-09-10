import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const INJECTED_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "Event",
  "MutationObserver",
  "ResizeObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

export interface MountedComponent {
  container: Element;
  /** Dispatches a bubbling click on `element` inside an async `act`, awaiting any resulting transitions. */
  click: (element: Element) => Promise<void>;
  /** Awaits a macrotask inside `act`, letting pending promises (e.g. an async transition) settle. */
  flush: () => Promise<void>;
  unmount: () => Promise<void>;
}

/** Mounts `element` into a linkedom document swapped into the globals, for tests that need real DOM events. */
export async function mountComponent(element: React.ReactElement): Promise<MountedComponent> {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const previous = Object.fromEntries(
    INJECTED_GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]),
  );
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Text: window.Text,
    Event: window.Event,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    getComputedStyle: () => ({ overflowY: "visible" }) as CSSStyleDeclaration,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const container = window.document.getElementById("root") as unknown as Element;
  let root: Root;

  await React.act(async () => {
    root = createRoot(container);
    root.render(element);
  });

  return {
    container,
    click: async (target: Element) => {
      await React.act(async () => {
        target.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    flush: async () => {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    unmount: async () => {
      await React.act(async () => {
        root.unmount();
      });
      for (const key of INJECTED_GLOBALS) {
        if (previous[key] === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
          continue;
        }
        (globalThis as Record<string, unknown>)[key] = previous[key];
      }
    },
  };
}
