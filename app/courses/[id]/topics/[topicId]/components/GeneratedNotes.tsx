type GeneratedNotesProps = {
  topic: {
    name: string;
    generationStatus: string;
  };
};

export default function GeneratedNotes({ topic }: GeneratedNotesProps) {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">{topic.name}</h1>

        <p>Generated notes will appear here.</p>
      </main>
    </div>
  );
}
