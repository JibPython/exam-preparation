// Never serialize SDK/Prisma error objects, causes, metadata, or request bodies.
function redact(value: string): string {
  return value
    // Prisma's formatted invocation can include the entire note in query arguments.
    .replace(/Invalid[\s\S]*?invocation[^\n]*\n[\s\S]*?\n\s*\}\)/g, "[Prisma invocation omitted]")
    .replace(/\b(?!file:)[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/gi, "[URL redacted]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[authorization redacted]")
    .replace(/\b(?:\w*(?:key|token|secret|password|credential)\w*|DATABASE_URL)\s*[:=]\s*\S+/gi, "[credential redacted]")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "[quoted value redacted]")
    .replace(/\b[A-Za-z0-9+/=_-]{64,}\b/g, "[data redacted]")
    .slice(0, 4000);
}

export function logGenerationError(stage: string, error: unknown, operation: string) {
  // Keep only error text and stack frames, never arbitrary enumerable properties.
  const message = error instanceof Error ? error.message :
    typeof error === "string" ? error : "Non-Error exception (value omitted)";
  // Payload-bearing errors are not safe to print even after token redaction.
  const redactedMessage = redact(message);
  const safeMessage = /(?:request|response|payload|inlineData|gatheredContent|markdown|content)\s*[=:]/i.test(redactedMessage)
    ? "[Payload-bearing error message omitted]" : redactedMessage;
  console.error("Note generation pipeline failed", {
    stage,
    operation,
    error: {
      name: error instanceof Error ? redact(error.name) : "NonError",
      message: safeMessage,
      stack: error instanceof Error ? error.stack?.split("\n")
        .filter((line) => /^\s+at\s/.test(line)).map(redact).join("\n") : undefined,
      code: error instanceof Error && "code" in error && typeof error.code === "string" &&
        /^(?:P\d{4}|[A-Z0-9_]{2,40})$/.test(error.code) ? error.code : undefined,
    },
  });
}
