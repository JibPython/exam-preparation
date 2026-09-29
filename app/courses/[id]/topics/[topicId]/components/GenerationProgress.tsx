"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ProcessingStage } from "@/src/generated/prisma/enums";

type Props = {
  topic: {
    name: string;
    processingStage: ProcessingStage | null;
  };
};

const stages = [
  {
    id: "READING_SOURCE",
    title: "Reading source material",
    description: "Understanding your uploaded material.",
  },
  {
    id: "ORGANISING_TOPICS",
    title: "Organising topics",
    description: "Identifying the topics and what needs to be covered.",
  },
  {
    id: "GATHERING_CONTENT",
    title: "Gathering relevant content",
    description: "Finding all relevant information for each topic.",
  },
  {
    id: "CONDENSING_NOTES",
    title: "Creating condensed notes",
    description: "Turning the material into concise notes in your preferred style.",
  },
  {
    id: "CHECKING_COVERAGE",
    title: "Checking coverage",
    description: "Checking your notes against the original material.",
  },
  {
    id: "CORRECTING_NOTES",
    title: "Correcting notes",
    description: "Fixing anything missing or inaccurate.",
  },
  {
    id: "CHECKING_STYLE",
    title: "Matching your note style",
    description: "Making sure the notes use your preferred condensed style.",
  },
  {
    id: "FINALISING",
    title: "Formatting notes",
    description: "Preparing your finished notes for viewing.",
  },
] satisfies { id: ProcessingStage; title: string; description: string }[];

export default function GenerationProgress({ topic }: Props) {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(interval);
  }, [router]);

  const currentIndex = stages.findIndex((stage) => stage.id === topic.processingStage);
  const currentStage = stages[currentIndex];

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">{topic.name}</h1>

        <h2 className="text-xl font-semibold">Generating your notes</h2>

        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="font-medium">
            {currentStage ? `${currentStage.title}...` : "Preparing your notes..."}
          </p>
          {currentStage && (
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              {currentStage.description}
            </p>
          )}
        </div>

        <ol className="w-full space-y-3" aria-label="Note generation stages">
          {stages.map((stage, index) => {
            const completed = index < currentIndex;
            const current = index === currentIndex;
            const status = completed ? "Completed" : current ? "Current" : "Upcoming";

            return (
              <li
                key={stage.id}
                aria-current={current ? "step" : undefined}
                className={`flex items-start gap-3 ${
                  current
                    ? "font-semibold text-zinc-950 dark:text-zinc-50"
                    : completed
                      ? "text-zinc-700 dark:text-zinc-300"
                      : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <span aria-hidden="true">{completed ? "✓" : current ? "●" : "○"}</span>
                <span>
                  <span className="sr-only">{status}: </span>
                  {stage.title}
                </span>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
}
