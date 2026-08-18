import { useEffect, useRef } from "react";

export function useScrollManager({}: useScrollManager.Options): useScrollManager.Result {
  const containerRef = useRef<{ element: HTMLElement; scrollListener: (event: Event) => unknown }>(undefined);

  function registerContainer(element: HTMLElement) {
    if (!containerRef.current) {
      containerRef.current = {
        element,
        scrollListener() {
          console.log("scroll");
        },
      };
      containerRef.current.element.addEventListener("scroll", containerRef.current.scrollListener);
    }
  }
  function deregisterContainer() {
    containerRef.current?.element.removeEventListener("scroll", containerRef.current.scrollListener);
  }
  useEffect(() => () => deregisterContainer(), []);

  return {
    registerContainer,
    toBottom() {
      const element = containerRef.current?.element;
      console.log(element);
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
    },
  };
}

export namespace useScrollManager {
  export type Options = {};
  export type Result = {
    registerContainer: (container: HTMLElement) => void;
    toBottom: () => unknown;
  };
}
