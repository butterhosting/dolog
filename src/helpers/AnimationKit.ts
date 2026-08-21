export namespace AnimationKit {
  export function wiggle(element: HTMLElement | null): void {
    element?.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-2px)" }, { transform: "translateX(2px)" }, { transform: "translateX(0)" }],
      { duration: 75, iterations: 2, easing: "ease-in-out" },
    );
  }
}
