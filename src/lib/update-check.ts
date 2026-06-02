/**
 * update-check.ts — pure logic for the "an update is available" banner.
 *
 * Deliberately free of any Tauri imports so it can be unit-tested. The network
 * call lives in cli.ts (`checkAppUpdate`); this module only parses a GitHub
 * release payload and decides whether it's a newer *stable* release than the
 * one currently running.
 */

/** This app's own repo — the `/latest` endpoint excludes drafts & prereleases. */
export const APP_RELEASES_API =
  "https://api.github.com/repos/Obsidian-TTRPG-Community/ttrpg-convert-cli-ui/releases/latest";

/** Human-facing releases page the Download button opens. */
export const APP_RELEASES_PAGE =
  "https://github.com/Obsidian-TTRPG-Community/ttrpg-convert-cli-ui/releases/latest";

export interface AppUpdate {
  /** Clean semver, e.g. "2.1.1". */
  version: string;
  /** Original tag, e.g. "v2.1.1". */
  tag: string;
  /** Release page URL to open for the download. */
  url: string;
}

/** Shape of the bits of the GitHub release JSON we care about. */
export interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
}

/** Strip a leading "v" and any -prerelease / +build suffix → numeric core. */
function core(v: string): number[] {
  const cleaned = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return cleaned.split(".").map((n) => {
    const x = parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
}

/** "v2.1.0" / "2.1.0" → "2.1.0" (leading v removed, trimmed). */
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, "");
}

/**
 * True if `latest` is a strictly newer release than `current`, comparing the
 * MAJOR.MINOR.PATCH core only. Prerelease/build suffixes are ignored, which is
 * fine because we only ever feed this stable releases from `/latest`.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = core(latest);
  const b = core(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false; // equal → not newer
}

/**
 * Decide whether a fetched release should prompt an update. Returns the update
 * details when the release is a stable one newer than `currentVersion`, else
 * null. Drafts and prereleases never prompt.
 */
export function pickAppUpdate(
  release: GithubRelease | null | undefined,
  currentVersion: string,
): AppUpdate | null {
  if (!release || release.draft || release.prerelease) return null;
  const tag = release.tag_name?.trim();
  if (!tag) return null;
  const version = normalizeVersion(tag);
  if (!isNewerVersion(version, currentVersion)) return null;
  return { version, tag, url: release.html_url || APP_RELEASES_PAGE };
}
