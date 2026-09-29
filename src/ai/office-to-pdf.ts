import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { SourcePreparationError } from "../../lib/source-formats";

export type OfficeRunner = (executable: string, args: string[], cwd: string) => Promise<void>;
const runOffice: OfficeRunner = (executable, args, cwd) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(executable, args, {
    cwd, windowsHide: true, shell: false, stdio: "ignore",
    detached: process.platform !== "win32",
    env: { ...process.env, TMPDIR: cwd, TEMP: cwd, TMP: cwd },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.pid) return;
    // Kill the converter's process tree, not only the soffice launcher.
    if (process.platform === "win32") {
      execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false }, () => {
        child.kill("SIGKILL");
      });
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  }, 120_000);
  child.once("error", () => { clearTimeout(timer); rejectRun(new Error("Converter could not start")); });
  child.once("close", (code) => {
    clearTimeout(timer);
    if (timedOut || code !== 0) rejectRun(new Error("Converter failed or timed out"));
    else resolveRun();
  });
});

export async function resolveSoffice(): Promise<string> {
  const executableNames = process.platform === "win32" ? ["soffice.com", "soffice.exe"] : ["soffice", "libreoffice"];
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => directory.replace(/^"|"$/g, ""));
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramW6432]) {
      if (root) directories.push(join(root, "LibreOffice", "program"));
    }
  }
  for (const directory of directories) {
    for (const name of executableNames) {
      const executable = resolve(directory, name);
      try {
        await access(executable);
        if ((await stat(executable)).isFile()) return executable;
      } catch { /* Try the next PATH or standard installation location. */ }
    }
  }
  throw new SourcePreparationError("PPTX/DOCX processing requires LibreOffice. Install LibreOffice locally or make soffice available on PATH.");
}

export async function convertOfficeToPdf(
  sourceBuffer: Buffer,
  extension: "pptx" | "docx",
  dependencies: { resolveExecutable?: () => Promise<string>; run?: OfficeRunner } = {},
): Promise<Buffer> {
  const executable = await (dependencies.resolveExecutable ?? resolveSoffice)();
  const tempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(tempRoot, "exam-prep-office-"));
  // Verify the exact recursive cleanup target is a child of the intended temp root.
  const child = relative(tempRoot, resolve(directory));
  if (!child || child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child)) {
    throw new SourcePreparationError("Could not create a safe conversion directory.");
  }
  try {
    const input = join(directory, `source.${extension}`);
    const output = join(directory, "source.pdf");
    await writeFile(input, sourceBuffer);
    // A separate profile avoids attaching to an open desktop instance or another job.
    await (dependencies.run ?? runOffice)(executable, [
      `-env:UserInstallation=${pathToFileURL(join(directory, "profile")).href}`,
      "--headless", "--nologo", "--nodefault", "--norestore",
      "--convert-to", extension === "pptx" ? "pdf:impress_pdf_Export" : "pdf:writer_pdf_Export",
      "--outdir", directory, input,
    ], directory);
    const size = (await stat(output)).size;
    // Rendering may expand a 10 MB upload; Gemini documents are limited to 50 MB.
    if (!size || size > 50_000_000) {
      throw new SourcePreparationError("Converted PDF is empty or exceeds Gemini's 50 MB document limit. Reduce embedded image sizes and upload again.");
    }
    const converted = await readFile(output);
    if (converted.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new SourcePreparationError("LibreOffice did not produce a valid PDF.");
    }
    return converted;
  } catch (error) {
    if (error instanceof SourcePreparationError) throw error;
    throw new SourcePreparationError("LibreOffice conversion failed or timed out. Ensure the PPTX/DOCX opens in LibreOffice and is not corrupt or password-protected.");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
