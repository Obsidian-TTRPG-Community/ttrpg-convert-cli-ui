import { describe, it, expect } from "vitest";
import { selectAsset, executableName, type ReleaseAsset, type HostInfo } from "../platform";

const V = "3.3.0";
const url = (n: string) => `https://example.com/${n}`;

// Representative asset list modelled on the live release: a runner jar plus
// per-OS native zips. The windows name is confirmed; mac/linux names use the
// conventional GraalVM/Quarkus tokens the matcher targets.
const assets: ReleaseAsset[] = [
  { name: `ttrpg-convert-cli-${V}-runner.jar`, browser_download_url: url("runner.jar") },
  { name: `ttrpg-convert-cli-${V}-runner.jar.sha256`, browser_download_url: url("runner.jar.sha256") },
  { name: `ttrpg-convert-cli-${V}-windows-x86_64.zip`, browser_download_url: url("win.zip") },
  { name: `ttrpg-convert-cli-${V}-linux-x86_64.zip`, browser_download_url: url("linux.zip") },
  { name: `ttrpg-convert-cli-${V}-darwin-amd64.zip`, browser_download_url: url("mac-intel.zip") },
  { name: `ttrpg-convert-cli-${V}-darwin-aarch64.zip`, browser_download_url: url("mac-arm.zip") },
];

const host = (os: HostInfo["os"], arch: HostInfo["arch"]): HostInfo => ({ os, arch });

describe("selectAsset", () => {
  it("picks the Windows x64 zip on Windows", () => {
    const m = selectAsset(assets, host("windows", "x64"));
    expect(m?.asset.name).toContain("windows-x86_64");
  });

  it("picks the Linux x64 zip on Linux", () => {
    const m = selectAsset(assets, host("linux", "x64"));
    expect(m?.asset.name).toContain("linux-x86_64");
  });

  it("picks the Intel mac zip on macOS x64", () => {
    const m = selectAsset(assets, host("macos", "x64"));
    expect(m?.asset.name).toContain("darwin-amd64");
  });

  it("prefers the arm64 mac zip on Apple Silicon", () => {
    const m = selectAsset(assets, host("macos", "arm64"));
    expect(m?.asset.name).toContain("darwin-aarch64");
  });

  it("falls back to the Intel mac zip on Apple Silicon when no arm build exists", () => {
    const noArm = assets.filter((a) => !a.name.includes("aarch64"));
    const m = selectAsset(noArm, host("macos", "arm64"));
    expect(m?.asset.name).toContain("darwin-amd64");
  });

  it("never selects the runner jar or checksum files", () => {
    for (const h of [host("windows", "x64"), host("linux", "x64"), host("macos", "arm64")]) {
      const m = selectAsset(assets, h);
      expect(m?.asset.name).not.toContain(".jar");
      expect(m?.asset.name).not.toContain(".sha256");
    }
  });

  it("returns null when no matching platform asset exists", () => {
    const onlyJar = assets.filter((a) => a.name.endsWith(".jar"));
    expect(selectAsset(onlyJar, host("linux", "x64"))).toBeNull();
  });

  it("scores an exact-arch match above an OS-only match", () => {
    const exact = selectAsset(assets, host("windows", "x64"))!;
    const osOnly = selectAsset(
      [{ name: `ttrpg-convert-cli-${V}-windows.zip`, browser_download_url: url("w.zip") }],
      host("windows", "x64"),
    )!;
    expect(exact.score).toBeGreaterThan(osOnly.score);
  });

  // Regression: the live 3.3.1 assets use os-maven-plugin classifiers with an
  // underscore (`aarch_64`). The Intel zip used to win on Apple Silicon because
  // `aarch_64` wasn't recognised and the x86_64 Rosetta-fallback outscored it.
  const real: ReleaseAsset[] = [
    { name: "ttrpg-convert-cli-3.3.1-linux-x86_64.zip", browser_download_url: url("l.zip") },
    { name: "ttrpg-convert-cli-3.3.1-osx-aarch_64.zip", browser_download_url: url("m-arm.zip") },
    { name: "ttrpg-convert-cli-3.3.1-osx-x86_64.zip", browser_download_url: url("m-intel.zip") },
    { name: "ttrpg-convert-cli-3.3.1-windows-x86_64.zip", browser_download_url: url("w.zip") },
    { name: "ttrpg-convert-cli-3.3.1-runner.jar", browser_download_url: url("r.jar") },
  ];
  it("picks osx-aarch_64 (not the Intel zip) on Apple Silicon — real 3.3.1 names", () => {
    const m = selectAsset(real, host("macos", "arm64"));
    expect(m?.asset.name).toBe("ttrpg-convert-cli-3.3.1-osx-aarch_64.zip");
  });
  it("picks osx-x86_64 on Intel macs — real 3.3.1 names", () => {
    const m = selectAsset(real, host("macos", "x64"));
    expect(m?.asset.name).toBe("ttrpg-convert-cli-3.3.1-osx-x86_64.zip");
  });
});

describe("executableName", () => {
  it("is .exe on Windows and bare elsewhere", () => {
    expect(executableName("windows")).toBe("ttrpg-convert.exe");
    expect(executableName("macos")).toBe("ttrpg-convert");
    expect(executableName("linux")).toBe("ttrpg-convert");
  });
});
