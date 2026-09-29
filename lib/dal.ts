import "server-only";
import { prisma } from "@/prisma";
import { deleteR2Objects } from "@/lib/r2";
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

export async function deleteCourse(courseId: number) {
  const session = await verifySession();

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      creatorId: session.userId,
    },
    select: {
      id: true,
      topics: {
        select: {
          sources: {
            select: {
              storageKey: true,
            },
          },
        },
      },
    },
  });

  if (!course) {
    throw new Error("Course not found");
  }

  const storageKeys = course.topics.flatMap((topic) =>
    topic.sources.map((source) => source.storageKey),
  );

  await deleteR2Objects(storageKeys);

  await prisma.course.delete({
    where: {
      id: course.id,
    },
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

  const topic = await prisma.topic.findFirst({
    where: {
      id: topicId,
      course: {
        creatorId: session.userId,
      },
    },
    select: {
      id: true,
      sources: {
        select: {
          storageKey: true,
        },
      },
    },
  });

  if (!topic) {
    throw new Error("Topic not found");
  }

  const storageKeys = topic.sources.map((source) => source.storageKey);

  await deleteR2Objects(storageKeys);

  return prisma.topic.delete({
    where: {
      id: topic.id,
    },
  });
}

// TOPIC PAGE

export const getTopic = cache(async (courseId: number, topicId: number) => {
  const session = await verifySession();

  return prisma.topic.findFirst({
    where: {
      id: topicId,
      courseId: courseId,
      course: {
        creatorId: session.userId,
      },
    },
    select: {
      id: true,
      name: true,
      generationStatus: true,
      processingStage: true,
      notes: { select: { content: true } },
    },
  });
});

export async function verifyTopicOwnership(topicId: number) {
  const session = await verifySession();

  const topic = await prisma.topic.findFirst({
    where: {
      id: topicId,
      course: {
        creatorId: session.userId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!topic) {
    throw new Error("Topic not found");
  }

  return topic;
}

type CreateSourceInput = {
  topicId: number;
  fileName: string;
  fileType: string;
  storageKey: string;
};

export async function createSource({
  topicId,
  fileName,
  fileType,
  storageKey,
}: CreateSourceInput) {
  const topic = await verifyTopicOwnership(topicId);

  return prisma.source.create({
    data: {
      topicId: topic.id,
      fileName,
      fileType,
      storageKey,
    },
  });
}

type GenerationStatus = "NOT_STARTED" | "PROCESSING" | "READY" | "FAILED";

export async function setTopicGenerationStatus(
  topicId: number,
  status: GenerationStatus,
) {
  const topic = await verifyTopicOwnership(topicId);

  return prisma.topic.update({
    where: {
      id: topic.id,
    },
    data: {
      generationStatus: status,
      processingStage: status === "PROCESSING" ? "READING_SOURCE" : null,
    },
  });
}

export async function startTopicProcessing(topicId: number) {
  const topic = await verifyTopicOwnership(topicId);

  return prisma.topic.update({
    where: {
      id: topic.id,
    },
    data: {
      generationStatus: "PROCESSING",
      processingStage: "READING_SOURCE",
    },
  });
}
