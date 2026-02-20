/**
 * Git Tools
 *
 * Built-in git operations for the automaton.
 * Used for both state versioning and code development.
 * Replaced Conway exec with local child_process execution.
 */

import type { GitStatus, GitLogEntry } from "../types.js";
import { spawn } from "child_process";

/**
 * Execute a shell command locally.
 */
async function execLocal(command: string, timeout: number = 30000): Promise<{stdout: string, stderr: string, exitCode: number}> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 });
    });

    child.on("error", (error) => {
      resolve({ stdout: "", stderr: error.message, exitCode: 1 });
    });
  });
}

/**
 * Get git status for a repository.
 */
export async function gitStatus(repoPath: string): Promise<GitStatus> {
  const result = await execLocal(
    `cd ${repoPath} && git status --porcelain -b 2>/dev/null`,
    10000,
  );

  const lines = result.stdout.split("\n").filter(Boolean);
  let branch = "unknown";
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const branchMatch = line.match(/## ([^\s.]+)/);
      if (branchMatch) branch = branchMatch[1];
    } else {
      const status = line.slice(0, 2);
      const file = line.slice(3);
      if (status[0] === "A" || status[0] === "M" || status[0] === "D") {
        staged.push(file);
      } else if (status[1] === "M" || status[1] === "D") {
        modified.push(file);
      } else if (status === "??") {
        untracked.push(file);
      }
    }
  }

  return {
    branch,
    staged,
    modified,
    untracked,
    clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
  };
}

/**
 * Initialize a new git repository.
 */
export async function gitInit(repoPath: string): Promise<void> {
  const result = await execLocal(
    `cd ${repoPath} && git init && git config user.name "Automaton" && git config user.email "automaton@bitcoin.local"`,
    10000,
  );

  if (result.exitCode !== 0) {
    throw new Error(`Git init failed: ${result.stderr}`);
  }
}

/**
 * Commit changes to git.
 */
export async function gitCommit(
  repoPath: string,
  message: string,
  addAll: boolean = true,
): Promise<void> {
  if (addAll) {
    await execLocal(`cd ${repoPath} && git add -A`, 10000);
  }

  const result = await execLocal(
    `cd ${repoPath} && git commit -m "${message.replace(/"/g, '\\"')}" 2>/dev/null`,
    15000,
  );

  if (result.exitCode !== 0 && !result.stderr.includes("nothing to commit")) {
    throw new Error(`Git commit failed: ${result.stderr}`);
  }
}

/**
 * Get git log entries.
 */
export async function gitLog(repoPath: string, limit: number = 10): Promise<GitLogEntry[]> {
  const result = await execLocal(
    `cd ${repoPath} && git log --oneline --format="%H|%s|%an|%ai" -n ${limit}`,
    10000,
  );

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      return {
        hash: parts[0] || "",
        message: parts[1] || "",
        author: parts[2] || "",
        date: parts[3] || "",
      };
    });
}

/**
 * Show git diff.
 */
export async function gitDiff(repoPath: string, staged: boolean = false): Promise<string> {
  const cmd = staged
    ? `cd ${repoPath} && git diff --cached`
    : `cd ${repoPath} && git diff`;

  const result = await execLocal(cmd, 15000);
  return result.stdout;
}

/**
 * Add file to git staging.
 */
export async function gitAdd(repoPath: string, file: string): Promise<void> {
  const result = await execLocal(`cd ${repoPath} && git add "${file}"`, 10000);

  if (result.exitCode !== 0) {
    throw new Error(`Git add failed: ${result.stderr}`);
  }
}

/**
 * Reset git changes.
 */
export async function gitReset(repoPath: string, hard: boolean = false): Promise<void> {
  const cmd = hard
    ? `cd ${repoPath} && git reset --hard HEAD`
    : `cd ${repoPath} && git reset HEAD`;

  const result = await execLocal(cmd, 10000);

  if (result.exitCode !== 0) {
    throw new Error(`Git reset failed: ${result.stderr}`);
  }
}

/**
 * Pull from remote.
 */
export async function gitPull(repoPath: string): Promise<void> {
  const result = await execLocal(`cd ${repoPath} && git pull`, 30000);

  if (result.exitCode !== 0) {
    throw new Error(`Git pull failed: ${result.stderr}`);
  }
}