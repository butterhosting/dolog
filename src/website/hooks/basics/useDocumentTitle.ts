import { useEffect, useRef } from "react";

export function useDocumentTitle(title: string): void {
  const originalTitleRef = useRef<{ title: string }>(undefined);
  useEffect(() => {
    if (!originalTitleRef.current) {
      originalTitleRef.current = { title: document.title };
    }
    document.title = title;
    return () => {
      document.title = originalTitleRef.current?.title || "";
    };
  }, [title]);
}
