import * as standard from "@pbzona/wires/components";
import { collectEntries } from "./library.js";

export const entries = collectEntries(
  import.meta.glob<Record<string, unknown>>(["../chips/**/*.ts", "!../chips/**/*.d.ts"], { eager: true }),
  import.meta.glob<Record<string, unknown>>(["../examples/**/*.ts", "!../examples/**/*.d.ts"], { eager: true }),
  standard,
);
