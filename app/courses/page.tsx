import { getCourses, createCourse, deleteCourse } from "@/lib/dal";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function Courses() {
  const courses = await getCourses();

  async function createCourseAction(formData: FormData) {
    "use server";

    const newCourse: string = formData.get("course-name") as string;

    if (typeof newCourse !== "string" || !newCourse.trim()) {
      throw new Error("Invalid course name");
    }

    await createCourse(newCourse);

    revalidatePath("/courses");
  }

  async function deleteCourseAction(courseId: number) {
    "use server";

    await deleteCourse(courseId);

    revalidatePath("/courses");
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center gap-8 py-32 px-16 bg-white dark:bg-black sm:items-start">
        <h1 className="underline">Courses</h1>
        <div className="flex flex-col gap-12">
          {courses.map((course) => (
            <div key={course.id}>
              <Link href={`/courses/${encodeURIComponent(course.id)}`}>
                {course.name}
              </Link>
              <form>
                <button
                  className="text-red-400"
                  formAction={deleteCourseAction.bind(null, course.id)}
                >
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>

        <form action={createCourseAction}>
          <input name="course-name" type="text" />
          <button>Add</button>
        </form>
      </main>
    </div>
  );
}
