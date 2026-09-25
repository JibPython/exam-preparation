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

// SINGLE COURSE PAGE

export const getCourseName = cache(async (id: number) => {
  const session = await verifySession();

  return prisma.course.findFirst({
    where: { id: id, creatorId: session.userId },
    select: { name: true },
  });
});

export const getTopics = cache(async (courseId: number) => {
  const session = await verifySession();

  return prisma.topic.findMany({
    where: { courseId: courseId, course: { creatorId: session.userId } },
  });
});

export async function createTopic(name: string, courseId: number) {
  const session = await verifySession();

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      creatorId: session.userId,
    },
    select: {
      id: true,
    },
  });

  if (!course) {
    throw new Error("Course not found");
  }

  return prisma.topic.create({
    data: {
      name,
      courseId: course.id,
    },
  });
}

export async function deleteTopic(topicId: number) {
  const session = await verifySession();

  return prisma.topic.deleteMany({
    where: {
      id: topicId,
      course: {
        creatorId: session.userId,
      },
    },
  });
}
