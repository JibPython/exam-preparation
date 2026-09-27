import { getCourseName, getTopics, createTopic, deleteTopic } from "@/lib/dal";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function Course({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const courseName = await getCourseName(Number(id));

  if (!courseName) {
    notFound();
  }

  const topics = await getTopics(Number(id));

  async function createTopicAction(formData: FormData) {
    "use server";

    const newTopic: string = formData.get("topic-name") as string;

    if (typeof newTopic !== "string" || !newTopic.trim()) {
      throw new Error("Invalid topic name");
    }

    await createTopic(newTopic, Number(id));

    revalidatePath(`/courses/${id}`);
  }

  async function deleteTopicAction(topicId: number) {
    "use server";

    await deleteTopic(topicId);

    revalidatePath(`/courses/${id}`);
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">{courseName.name} (Tasks)</h1>
        {topics.map((topic) => (
          <div key={topic.id}>
            <Link
              href={`/courses/${encodeURIComponent(id)}/topics/${encodeURIComponent(topic.id)}`}
            >
              {topic.name}
            </Link>
            <form>
              <button
                className="text-red-400"
                formAction={deleteTopicAction.bind(null, topic.id)}
              >
                Delete
              </button>
            </form>
          </div>
        ))}
        <form action={createTopicAction}>
          <input name="topic-name" type="text" />
          <button>Add</button>
        </form>
      </main>
    </div>
  );
}
