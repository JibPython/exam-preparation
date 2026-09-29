import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) redirect("/courses");

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <h1>Sign in</h1>

      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div>
          <form
            className="border border-1"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/courses" });
            }}
          >
            <button type="submit">Google Signin</button>
          </form>
        </div>
      </main>
    </div>
  );
}
