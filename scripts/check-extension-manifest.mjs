import { readFile } from "node:fs/promises";

const manifestPath = new URL(
  "../apps/extension/dist/manifest.json",
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];

if (manifest.manifest_version !== 3) {
  errors.push("manifest_version must be 3");
}
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version ?? "")) {
  errors.push("version must be a Chrome-compatible numeric version");
}
if ("key" in manifest) {
  errors.push("Chrome Web Store manifests must not contain the development-only key field");
}

const permissions = manifest.permissions ?? [];
const requiredPermissions = ["sidePanel", "storage", "tabs"];
const forbiddenPermissions = [
  "activeTab",
  "cookies",
  "declarativeNetRequest",
  "scripting",
  "webRequest",
];
for (const permission of requiredPermissions) {
  if (!permissions.includes(permission)) {
    errors.push(`required permission ${permission} is missing`);
  }
}
for (const permission of forbiddenPermissions) {
  if (permissions.includes(permission)) {
    errors.push(`broad permission ${permission} is forbidden`);
  }
}

const hosts = manifest.host_permissions ?? [];
const leetcodeHosts = ["https://leetcode.com/*", "https://leetcode.cn/*"];
for (const host of leetcodeHosts) {
  if (!hosts.includes(host)) {
    errors.push(`the exact LeetCode host permission ${host} is missing`);
  }
}
if (hosts.length !== leetcodeHosts.length + 1) {
  errors.push("Production must have exactly three required host permissions");
}
if (
  hosts.some(
    (host) =>
      host.includes("localhost") ||
      host.includes("127.0.0.1") ||
      host.includes("://*.") ||
      host === "https://*/*" ||
      host === "http://*/*",
  )
) {
  errors.push("Production required hosts must not contain local or wildcard origins");
}

const apiHosts = hosts.filter((host) => !leetcodeHosts.includes(host));
if (
  apiHosts.length !== 1 ||
  !/^https:\/\/[^*/]+\/\*$/.test(apiHosts[0] ?? "")
) {
  errors.push("Production must contain one exact HTTPS API host");
}

const contentMatches = (manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []);
for (const host of leetcodeHosts) {
  if (!contentMatches.includes(host.replace("/*", "/problems/*"))) {
    errors.push(`content scripts must run on ${host}`);
  }
}

const optionalHosts = manifest.optional_host_permissions ?? [];
if (optionalHosts.length > 0) {
  errors.push("Production must not request optional host permissions");
}

if (errors.length > 0) {
  console.error("Extension manifest validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `✓ Extension ${manifest.version} manifest validated (${permissions.length} permissions, ${hosts.length} exact required hosts)`,
);
