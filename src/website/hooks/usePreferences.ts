import { LocalStorageStore } from "@/helpers/LocalStorageStore";
import { TextSize } from "@/models/TextSize";
import { useSyncExternalStore } from "react";
import z from "zod/v4";

export function usePreferences() {
  const store = LocalStorageStore.sharedModuleInstance({
    key: "dolog.preferences",
    schema: z.object({
      showStoppedContainers: z.boolean(),
      textSize: z.enum(TextSize),
    }),
    defaults: {
      showStoppedContainers: false,
      textSize: TextSize.m,
    },
  });
  const preferences = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    ...preferences,
    update: store.update,
  };
}
