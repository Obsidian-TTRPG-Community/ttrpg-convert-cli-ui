/**
 * platform.ts — host-OS detection and ttrpg-convert-cli release-asset matching.
 *
 * This is the heart of the cross-platform support. The original Windows UI
 * hard-coded the asset name `windows-x86_64.zip`. Here we instead inspect the
 * GitHub release's asset list and score each candidate against the host's
 * OS + CPU architecture, so the same code picks the right native binary on
 * Windows, macOS (Intel or Apple Silicon), and Linux.
 *
 * The matcher is keyword-based rather than exact-name based so it survives
 * naming changes across releases. NOTE: the Windows asset name
 * (`...-windows-x86_64.zip`) is confirmed from the live release; the exact
 * macOS/Linux strings should be verified against a current release and the
 * keyword groups below adjusted if upstream uses different tokens.
 */

export type OsKind = "windows" | "macos" | "linux";
export type ArchKind = "x64" | "arm64";

export interface HostInfo {
  os: OsKind;
  arch: ArchKind;
}

/** Keyword groups used to recognise an asset for a given OS. */
const OS_TOKENS: Record<OsKind, string[]> = {
  windows: ["windows", "win"],
  macos: ["mac", "macos", "darwin", "osx", "apple"],
  linux: ["linux"],
};

/** Architecture tokens, most-specific first. */
const ARCH_TOKENS: Record<ArchKind, string[]> = {
  x64: ["x86_64", "amd64", "x64", "x86-64"],
  arm64: ["aarch64", "arm64", "apple-silicon", "applesilicon"],
};

/** A GitHub release asset (only the fields we need). */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface AssetMatch {
  asset: ReleaseAsset;
  /** Higher is better; lets callers log why a pick was made. */
  score: number;
}

const ARCHIVE_EXT = [".zip", ".tar.gz", ".tgz"];

function hasToken(haystack: string, tokens: string[]): boolean {
  return tokens.some((t) => haystack.includes(t));
}

function isArchive(name: string): boolean {
  const lower = name.toLowerCase();
  return ARCHIVE_EXT.some((ext) => lower.endsWith(ext));
}

/**
 * Choose the best native-binary asset for the host from a release's assets.
 * Returns null if nothing suitable is found (caller should fall back to the
 * runner jar or surface an actionable error).
 */
export function selectAsset(assets: ReleaseAsset[], host: HostInfo): AssetMatch | null {
  const osTokens = OS_TOKENS[host.os];
  const wantArch = ARCH_TOKENS[host.arch];
  // On Apple Silicon a universal/x64 build still runs under Rosetta, so allow
  // x64 as a lower-scoring fallback for macos/arm64.
  const fallbackArch = host.arch === "arm64" ? ARCH_TOKENS.x64 : [];

  let best: AssetMatch | null = null;

  for (const asset of assets) {
    const name = asset.name.toLowerCase();

    // Must be a platform archive, never the bare runner jar.
    if (!isArchive(name)) continue;
    if (name.endsWith(".jar")) continue;
    if (!hasToken(name, osTokens)) continue;

    let score = 10; // base: correct OS + is an archive
    if (hasToken(name, wantArch)) {
      score += 10; // exact arch
    } else if (hasToken(name, fallbackArch)) {
      score += 3; // runnable via Rosetta
    } else {
      // OS matched but arch unknown — could be a universal build; keep, low score.
      score += 1;
    }
    // Prefer .zip slightly (simplest to extract cross-platform).
    if (name.endsWith(".zip")) score += 1;

    if (!best || score > best.score) {
      best = { asset, score };
    }
  }

  return best;
}

/**
 * Name of the converter executable inside the extracted archive, per OS.
 * The original looked for `ttrpg-convert.exe`; on macOS/Linux it is the
 * extension-less `ttrpg-convert`.
 */
export function executableName(os: OsKind): string {
  return os === "windows" ? "ttrpg-convert.exe" : "ttrpg-convert";
}

/** GitHub API URL for the latest stable release of the converter. */
export const LATEST_RELEASE_API =
  "https://api.github.com/repos/ebullient/ttrpg-convert-cli/releases/latest";
