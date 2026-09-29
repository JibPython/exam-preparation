import { registerHooks } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, access, readdir, truncate } from "node:fs/promises";
import { join, basename } from "node:path";
import { zipSync, strToU8 } from "fflate";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { getSourceFormat, validateSourceBytes, MAX_SOURCE_BYTES, SourcePreparationError } = await import("../../lib/source-formats.ts");
const { prepareSourceForGemini, sourceInput, sourceReferenceRules } = await import("./prepare-source.ts");
const { convertOfficeToPdf, resolveSoffice } = await import("./office-to-pdf.ts");
const pdf = Buffer.from("%PDF-1.7\nmock rendered content\n%%EOF");
const office = (extension) => Buffer.from(zipSync({
  "[Content_Types].xml": strToU8("<Types/>"),
  [extension === "pptx" ? "ppt/presentation.xml" : "word/document.xml"]: strToU8("<document/>"),
}));
const fixtures = [
  ["pdf", "application/pdf", pdf],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", office("pptx")],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", office("docx")],
  ["png", "image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
  ["jpg", "image/jpeg", Buffer.from([255, 216, 255, 217])],
  ["jpeg", "image/jpeg", Buffer.from([255, 216, 255, 217])],
  ["webp", "image/webp", Buffer.from("RIFF0000WEBP")],
  ["txt", "text/plain", Buffer.from("Learning material — UTF-8")],
  ["md", "text/markdown", Buffer.from("# Learning material")],
];

for (const [extension, mimeType, bytes] of fixtures) {
  test(`${extension} accepted with trusted extension and canonical MIME`, () => {
    const format = getSourceFormat(`lecture.${extension.toUpperCase()}`, mimeType);
    assert.equal(format.extension, extension);
    assert.equal(format.mimeType, mimeType);
    validateSourceBytes(bytes, format);
    const storageKey = `sources/topics/1/generated-id.${format.extension}`;
    assert.equal(storageKey, `sources/topics/1/generated-id.${extension}`);
  });
}

test("browser MIME variations work without allowing arbitrary extensions", () => {
  for (const mime of ["", "application/octet-stream", "text/plain", "text/x-markdown", "text/markdown; charset=utf-8"]) {
    assert.equal(getSourceFormat("lecture.md", mime).mimeType, "text/markdown");
  }
  assert.equal(getSourceFormat("lecture.pptx", "application/zip").extension, "pptx");
  for (const name of ["source.exe", "source.xlsx", "source.pdf.exe", "source", "source.mp4", "source.svg"]) {
    assert.throws(() => getSourceFormat(name, "application/pdf"), SourcePreparationError);
  }
  assert.throws(() => getSourceFormat("source.pdf", "image/png"), /do not match/);
});

test("mislabeled binaries, unrelated ZIPs, empty and oversized files are rejected", () => {
  assert.throws(() => validateSourceBytes(Buffer.from("MZbinary"), getSourceFormat("x.pdf", "")));
  const zip = Buffer.from(zipSync({ "unrelated.txt": strToU8("not Office") }));
  assert.throws(() => validateSourceBytes(zip, getSourceFormat("x.pptx", "")));
  assert.throws(() => validateSourceBytes(office("pptx"), getSourceFormat("x.docx", "")));
  assert.throws(() => validateSourceBytes(Buffer.alloc(0), getSourceFormat("x.txt", "")));
  assert.throws(() => validateSourceBytes(Buffer.alloc(MAX_SOURCE_BYTES + 1), getSourceFormat("x.txt", "")));
});

test("PDF and all images pass original bytes directly without Office conversion", async () => {
  for (const [extension, mimeType, bytes] of fixtures.filter(([extension]) => ["pdf", "png", "jpg", "jpeg", "webp"].includes(extension))) {
    const prepared = await prepareSourceForGemini(bytes, { fileName: `x.${extension}`, fileType: mimeType }, () => { throw new Error("Must not convert"); });
    assert.equal(prepared.data, bytes);
    assert.equal(prepared.kind, extension === "pdf" ? "document" : "image");
    assert.deepEqual(sourceInput(prepared), { inlineData: { mimeType, data: bytes.toString("base64") } });
    assert.ok(sourceReferenceRules(prepared).includes(extension === "pdf" ? "page N" : "uploaded image"));
  }
});

test("TXT/MD become exact UTF-8 text with no page/visual assumptions", async () => {
  for (const extension of ["txt", "md"]) {
    const text = "# Cells\nα → β\n";
    const prepared = await prepareSourceForGemini(Buffer.from(text), { fileName: `x.${extension}`, fileType: "text/plain" }, () => { throw new Error("Must not convert"); });
    assert.equal(prepared.kind, "text");
    assert.equal(prepared.text, text);
    assert.ok(sourceInput(prepared).text.endsWith(text));
    assert.ok(sourceReferenceRules(prepared).includes("Never invent page numbers, visuals"));
  }
  await assert.rejects(prepareSourceForGemini(Buffer.from([255, 254]), { fileName: "x.txt", fileType: "" }), /UTF-8/);
  await assert.rejects(prepareSourceForGemini(Buffer.from("binary\0data"), { fileName: "x.md", fileType: "" }), /UTF-8/);
});

for (const extension of ["pptx", "docx"]) {
  test(`${extension} renders to PDF in an isolated directory and cleans up`, async () => {
    const original = office(extension);
    let tempDirectory;
    const prepared = await prepareSourceForGemini(original, { fileName: `untrusted;name.${extension}`, fileType: "" }, (bytes, actualExtension) => convertOfficeToPdf(bytes, actualExtension, {
      resolveExecutable: async () => "mock-soffice",
      run: async (executable, args, directory) => {
        tempDirectory = directory;
        assert.equal(executable, "mock-soffice");
        assert.ok(args.includes("--headless"));
        assert.ok(args.includes(extension === "pptx" ? "pdf:impress_pdf_Export" : "pdf:writer_pdf_Export"));
        assert.ok(args[0].startsWith("-env:UserInstallation=file:"));
        assert.equal(args[args.indexOf("--outdir") + 1], directory);
        assert.equal(basename(args.at(-1)), `source.${extension}`);
        assert.ok(!args.join(" ").includes("untrusted"));
        assert.deepEqual(await readFile(args.at(-1)), original);
        assert.deepEqual(await readdir(directory), [`source.${extension}`]);
        await writeFile(join(directory, "source.pdf"), pdf);
      },
    }));
    assert.equal(prepared.kind, "document");
    assert.equal(prepared.mimeType, "application/pdf");
    assert.deepEqual(prepared.data, pdf);
    assert.equal(prepared.referenceUnit, extension === "pptx" ? "slide" : "page");
    await assert.rejects(access(tempDirectory));
  });
}

test("conversion failures, missing output, corrupt output and timeouts clean up and sanitize errors", async () => {
  for (const mode of ["throw", "missing", "corrupt", "oversized"]) {
    let tempDirectory;
    await assert.rejects(convertOfficeToPdf(office("pptx"), "pptx", {
      resolveExecutable: async () => "mock-soffice",
      run: async (_executable, _args, directory) => {
        tempDirectory = directory;
        if (mode === "throw") throw new Error("private-process-output");
        if (mode === "corrupt") await writeFile(join(directory, "source.pdf"), "not a pdf");
        if (mode === "oversized") {
          await writeFile(join(directory, "source.pdf"), pdf);
          await truncate(join(directory, "source.pdf"), 50_000_001);
        }
      },
    }), (error) => error instanceof SourcePreparationError && !error.message.includes("private-process-output"));
    await assert.rejects(access(tempDirectory));
  }
});

test("missing LibreOffice reports an actionable error without text fallback", async () => {
  const names = ["PATH", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    await assert.rejects(resolveSoffice(), /Install LibreOffice locally/);
    await assert.rejects(convertOfficeToPdf(office("docx"), "docx", {
      run: async () => { assert.fail("Must not run without LibreOffice"); },
    }), /Install LibreOffice locally/);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
