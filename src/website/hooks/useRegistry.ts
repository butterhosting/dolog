import { Class } from "@/types/Class";
import { useContext } from "react";
import { ClientRegistry } from "../ClientRegistry";
import { Env } from "@/Env";

export function useRegistry(env: "env"): Env.Public;

export function useRegistry<T>(klass: Class<T>): T;

export function useRegistry<T>(arg: "env" | Class<T>): Env.Public | T {
  const context = useContext(ClientRegistry.Context);
  if (arg === "env") {
    return context.getEnv();
  }
  return context.get(arg);
}
