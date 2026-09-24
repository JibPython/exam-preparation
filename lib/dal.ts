import "server-only";
import { prisma } from "@/prisma";

import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const verifySession = cache(async () => {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return {
    isAuth: true,
    userId: session.user.id,
  };
});

// COURSES PAGE

export const getCourses = cache(async () => {
  const session = await verifySession();

  return prisma.course.findMany({ where: { creatorId: session.userId } });
});

export async function createCourse(name: string) {
  const session = await verifySession();

  return prisma.course.create({
    data: { name: name, creatorId: session.userId },
  });
}

export async function deleteCourse(id: number) {
  const session = await verifySession();

  return prisma.course.deleteMany({
    where: { id: id, creatorId: session.userId },
  });
}
