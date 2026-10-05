import { describe, expect, it } from "bun:test";
import { Svc } from "./Svc";

describe("Svc", () => {
  describe("displayGroup", () => {
    const svc = (dgroup: string | undefined, dlabels: Record<string, string>) => ({ dgroup, mostRecentContainer: { dimage: "nginx:latest", dlabels } });

    it("should list a service under its docker group when it has no label", () => {
      expect(Svc.displayGroup(svc("shop", {}))).toEqual("shop");
      expect(Svc.displayGroup(svc(undefined, {}))).toBeUndefined();
    });

    it("should let the label move a service to another group, or into one", () => {
      expect(Svc.displayGroup(svc("shop", { "display.group": "storefront" }))).toEqual("storefront");
      expect(Svc.displayGroup(svc(undefined, { "display.group": "storefront" }))).toEqual("storefront");
    });

    it("should leave a service ungrouped when its label is empty", () => {
      expect(Svc.displayGroup(svc("shop", { "display.group": "" }))).toBeUndefined();
      expect(Svc.displayGroup(svc("shop", { "display.group": "  " }))).toBeUndefined();
    });
  });
});
