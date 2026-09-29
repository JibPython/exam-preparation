import { GoogleGenAI } from "@google/genai";
import { task } from "@trigger.dev/sdk";

export const testGemini = task({
  id: "test-gemini",
  retry: { maxAttempts: 1 },

  run: async () => {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured in the Trigger.dev worker");
    }

    let text: string | undefined;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: "Reply with exactly: Gemini connection successful",
      });
      text = response.text;
    } catch {
      // Keep SDK request details and credentials out of task errors.
      throw new Error(
        "Gemini connectivity test failed. Check the worker's GEMINI_API_KEY, model access, and API quota.",
      );
    }

    if (!text?.trim()) {
      throw new Error("Gemini returned no text response");
    }

    return text;
  },
});
