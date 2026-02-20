import fs from "fs";

export interface EnvironmentInfo {
  type: string;
}

export function detectEnvironment(): EnvironmentInfo {
  // 1. Check Docker
  if (fs.existsSync("/.dockerenv")) {
    return { type: "docker" };
  }

  // 2. Check for common development environments
  if (process.env.NODE_ENV === "development") {
    return { type: "development" };
  }

  // 3. Fall back to platform
  return { type: process.platform };
}