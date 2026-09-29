import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type GeneratedNotesProps = {
  topic: {
    name: string;
    generationStatus: string;
    notes: { content: string } | null;
  };
};

export default function GeneratedNotes({ topic }: GeneratedNotesProps) {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">{topic.name}</h1>

        {topic.notes ? (
          <article className="w-full break-words text-zinc-900 dark:text-zinc-100 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-medium [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null }}>
              {topic.notes.content}
            </Markdown>
          </article>
        ) : (
          <p>No generated notes are available.</p>
        )}
      </main>
    </div>
  );
}
