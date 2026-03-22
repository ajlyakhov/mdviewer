const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;
const BUMP_TYPES = new Set(["patch", "minor", "major"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const details = stderr || stdout;
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}${details ? `\n${details}` : ""}`
    );
  }

  return result;
}

function parseSemver(version) {
  if (!SEMVER_REGEX.test(version)) {
    throw new Error(`Version "${version}" must match X.X.X format.`);
  }

  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpVersion(version, bumpType) {
  const parsed = parseSemver(version);

  if (bumpType === "major") {
    return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
  }
  if (bumpType === "minor") {
    return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }
  if (bumpType === "patch") {
    return formatSemver({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
  }

  throw new Error(`Unsupported bump type "${bumpType}".`);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positionalArgs = args.filter((arg) => !arg.startsWith("--"));

  if (positionalArgs.length > 1) {
    throw new Error(
      'Usage: npm run publish -- [patch|minor|major|X.X.X] [--dry-run]'
    );
  }

  const releaseArgRaw = positionalArgs[0] || "patch";
  const releaseArg = releaseArgRaw.startsWith("v") ? releaseArgRaw.slice(1) : releaseArgRaw;
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const currentVersion = (packageJson.version || "").trim();

  if (!currentVersion) {
    throw new Error("No version found in package.json.");
  }

  parseSemver(currentVersion);

  const nextVersion = BUMP_TYPES.has(releaseArg)
    ? bumpVersion(currentVersion, releaseArg)
    : releaseArg;

  if (!SEMVER_REGEX.test(nextVersion)) {
    throw new Error(
      `Release argument "${releaseArgRaw}" is invalid. Use patch/minor/major or X.X.X.`
    );
  }

  if (nextVersion === currentVersion) {
    throw new Error(`Version is already "${nextVersion}". Bump or pass a different version.`);
  }

  run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });

  const gitStatus = run("git", ["status", "--porcelain"], { capture: true }).stdout.trim();
  if (gitStatus) {
    throw new Error("Working tree is not clean. Commit or stash changes before publish.");
  }

  const localTag = run("git", ["tag", "-l", nextVersion], { capture: true }).stdout.trim();
  if (localTag) {
    throw new Error(`Local tag "${nextVersion}" already exists.`);
  }

  const remoteTag = run(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${nextVersion}`],
    { capture: true }
  ).stdout.trim();
  if (remoteTag) {
    throw new Error(`Remote tag "${nextVersion}" already exists on origin.`);
  }

  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version: ${nextVersion}`);

  if (dryRun) {
    console.log("[dry-run] Would run: npm version " + releaseArg + " --no-git-tag-version");
    console.log("[dry-run] Would run: git add package.json package-lock.json");
    console.log(`[dry-run] Would run: git commit -m "chore(release): v${nextVersion}"`);
    console.log("[dry-run] Would run: git tag " + nextVersion);
    console.log("[dry-run] Would run: git push origin HEAD");
    console.log("[dry-run] Would run: git push origin " + nextVersion);
    return;
  }

  run("npm", ["version", releaseArg, "--no-git-tag-version"]);

  const updatedPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const finalVersion = (updatedPackageJson.version || "").trim();
  if (finalVersion !== nextVersion) {
    throw new Error(`Version bump mismatch. Expected "${nextVersion}", got "${finalVersion}".`);
  }

  const filesToAdd = ["package.json"];
  const packageLockPath = path.join(__dirname, "..", "package-lock.json");
  if (fs.existsSync(packageLockPath)) {
    filesToAdd.push("package-lock.json");
  }

  run("git", ["add", ...filesToAdd]);
  run("git", ["commit", "-m", `chore(release): v${finalVersion}`]);
  run("git", ["tag", finalVersion]);
  run("git", ["push", "origin", "HEAD"]);
  run("git", ["push", "origin", finalVersion]);
  console.log(`Released v${finalVersion}: version bumped, committed, tagged, and pushed.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
