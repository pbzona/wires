import { describe, expect, it } from "vitest";
import { WiresError } from "@pbzona/wires";
import { checkNodeVersion } from "../src/core/runtime.js";

describe("Node.js version policy", () => {
  it.each(["24.0.0", "24.15.0", "26.3.0", "27.1.0"])("accepts Node.js %s", (version) => {
    expect(() => checkNodeVersion(version)).not.toThrow();
  });

  it.each(["18.20.0", "20.20.2", "22.21.1", "25.2.0"])("rejects end-of-life Node.js %s", (version) => {
    expect(() => checkNodeVersion(version)).toThrow(WiresError);
    expect(() => checkNodeVersion(version)).toThrow(
      `@pbzona/wires requires Node.js 24, or 26 and later (found ${version})`,
    );
  });

  it("does not check environments without Node.js, such as browsers", () => {
    expect(() => checkNodeVersion(undefined)).not.toThrow();
  });
});
