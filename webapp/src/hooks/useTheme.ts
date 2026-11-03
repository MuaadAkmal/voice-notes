"use client";

import { useSyncExternalStore } from "react";
import { getTheme, subscribeTheme, type Theme } from "@/lib/theme";

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, () => "light");
}
