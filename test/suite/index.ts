import * as path from "node:path";
import { readdir } from "node:fs/promises";
import Mocha from "mocha";

async function findTestFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true });
  const testsRoot = __dirname;
  for (const file of await findTestFiles(testsRoot)) {
    mocha.addFile(file);
  }
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
