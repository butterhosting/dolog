import { Fragment, ReactNode, Ref, useImperativeHandle, useState } from "react";

type Props = {
  ref: Ref<DialogManager.Api>;
};
export function DialogManager({ ref }: Props): ReactNode {
  const [nodeMap, setNodeMap] = useState<Map<string, ReactNode>>(new Map());
  useImperativeHandle(ref, () => ({
    insert: (node) => {
      const token = `${Math.random()}`;
      setNodeMap((map) => {
        const updatedMap = new Map(map);
        updatedMap.set(token, node);
        return updatedMap;
      });
      return { token };
    },
    remove: ({ token }) => {
      setNodeMap((map) => {
        const updatedMap = new Map(map);
        updatedMap.delete(token);
        return updatedMap;
      });
    },
  }));
  return [...nodeMap.entries()].map(([token, node]) => <Fragment key={token}>{node}</Fragment>);
}
export namespace DialogManager {
  export type Api = {
    insert(node: ReactNode): { token: string };
    remove(opts: { token: string }): void;
  };
}
