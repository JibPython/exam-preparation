import { getTopic } from "@/lib/dal";
import { notFound } from "next/navigation";
import TopicSetup from "./components/TopicSetup";
import GenerationProgress from "./components/GenerationProgress";
import GeneratedNotes from "./components/GeneratedNotes";
import GenerationFailed from "./components/GenerationFailed";

export default async function Topic({
  params,
}: {
  params: Promise<{ id: string; topicId: string }>;
}) {
  const { id, topicId } = await params;

  const topic = await getTopic(Number(id), Number(topicId));
  if (!topic) {
    notFound();
  }

  switch (topic.generationStatus) {
    case "NOT_STARTED":
      return <TopicSetup topic={topic} courseId={Number(id)} />;

    case "PROCESSING":
      return <GenerationProgress topic={topic} />;

    case "READY":
      return <GeneratedNotes topic={topic} />;

    case "FAILED":
      return <GenerationFailed topic={topic} />;
  }
}
