const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const explicitTag = args.find((arg) => !arg.startsWith("--"));
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const tag = (explicitTag || packageJson.version || "").trim();

  if (!tag) {
    throw new Error("No tag found. Set package.json version or pass an explicit tag.");
  }

  if (!/^\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Tag "${tag}" must match X.X.X format.`);
  }

  run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });

  const localTag = run("git", ["tag", "-l", tag], { capture: true }).stdout.trim();
  if (localTag) {
    throw new Error(`Local tag "${tag}" already exists.`);
  }

  const remoteTag = run(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${tag}`],
    { capture: true }
  ).stdout.trim();
  if (remoteTag) {
    throw new Error(`Remote tag "${tag}" already exists on origin.`);
  }

  console.log(`Using tag: ${tag}`);

  if (dryRun) {
    console.log("[dry-run] Would run: git tag " + tag);
    console.log("[dry-run] Would run: git push origin " + tag);
    return;
  }

  run("git", ["tag", tag]);
  run("git", ["push", "origin", tag]);
  console.log(`Tag "${tag}" created and pushed to origin.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
