import { describe, expect, test } from "bun:test";
import { installerEnvironment, latestRelease, releaseTag, windowsUpdateArguments } from "./update";

describe("latestRelease", () => {
  test("takes the newest publication, ignoring drafts and list order", () => {
    expect(latestRelease([
      { tag_name: "v0.1.0", draft: false, published_at: "2026-08-30T13:23:19Z" },
      { tag_name: "v3.0.0", draft: true, published_at: "2026-12-30T00:00:00Z" },
      { tag_name: "v2.0.0-beta.1", draft: false, prerelease: true, published_at: "2026-11-28T08:20:44Z" },
    ])).toBe("v2.0.0-beta.1");
  });

  test("returns null for a response without releases", () => {
    for (const response of [[], {}, null, [{ draft: false }], { message: "rate limited" }]) {
      expect(latestRelease(response)).toBeNull();
    }
  });
});

describe("releaseTag", () => {
  test("accepts a version with or without the v", () => {
    expect(releaseTag("1.0.0-beta.2")).toBe("v1.0.0-beta.2");
    expect(releaseTag("v1.2.3")).toBe("v1.2.3");
  });

  test("rejects anything that is not a version", () => {
    for (const value of ["", "latest", "v1", "1.2.3; rm -rf ~", "v1.2.3/../x"]) {
      expect(() => releaseTag(value)).toThrow();
    }
  });
});

describe("installerEnvironment", () => {
  test("does not pin the installer to the running version", () => {
    // The `luma` command exports LUMA_VERSION, which the installer reads as a pin.
    const env = installerEnvironment({ LUMA_VERSION: "1.0.0", LUMA_HOME: "/home/luma" });
    expect(env.LUMA_VERSION).toBeUndefined();
    expect(env.LUMA_HOME).toBe("/home/luma");
  });

  test("pins a requested version", () => {
    expect(installerEnvironment({ LUMA_VERSION: "1.0.0" }, "v2.0.0").LUMA_VERSION).toBe("v2.0.0");
  });

  test("reinstalls the commands where they are, unless told otherwise", () => {
    expect(installerEnvironment({ LUMA_INSTALLED_BIN_DIR: "/a" }).LUMA_BIN_DIR).toBe("/a");
    expect(installerEnvironment({ LUMA_INSTALLED_BIN_DIR: "/a", LUMA_BIN_DIR: "/b" }).LUMA_BIN_DIR).toBe("/b");
  });

  test("does not ask the setup questions again", () => {
    expect(installerEnvironment({}).LUMA_SKIP_SETUP).toBe("1");
    expect(installerEnvironment({ LUMA_SKIP_SETUP: "0" }).LUMA_SKIP_SETUP).toBe("0");
  });
});

test("on Windows the installer waits for this process, which holds the runtime open", () => {
  const args = windowsUpdateArguments("C:\\Temp\\it's here\\install.ps1", 4321);
  const command = args.at(-1) ?? "";
  expect(args).toContain("-NoProfile");
  expect(command).toContain("Wait-Process -Id 4321");
  expect(command.indexOf("Wait-Process")).toBeLessThan(command.indexOf("install.ps1"));
  expect(command).toContain("& 'C:\\Temp\\it''s here\\install.ps1'");
  expect(command).toContain("Read-Host");
});
