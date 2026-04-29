import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const extensionTestsPath = resolve(extensionDevelopmentPath, "out-test/test/suite/index.js");
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

