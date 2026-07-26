/**
 * Sync lesson.videoUrl / videoType / videoPublicId from videos[0]
 * and keep videos array coherent with legacy single-video fields.
 */
export function syncLessonPrimaryVideo(lesson) {
  if (!lesson) return lesson;

  const videos = Array.isArray(lesson.videos) ? [...lesson.videos] : [];

  // If videos empty but legacy videoUrl set, seed videos[]
  if (!videos.length && lesson.videoUrl) {
    videos.push({
      title: "Video 1",
      videoUrl: lesson.videoUrl,
      videoPublicId: lesson.videoPublicId || "",
      videoType: lesson.videoType || "url",
      durationMinutes: lesson.durationMinutes || 0,
      order: 0,
    });
    lesson.videos = videos;
  }

  // Sort by order
  if (Array.isArray(lesson.videos) && lesson.videos.length) {
    lesson.videos.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const first = lesson.videos[0];
    lesson.videoUrl = first.videoUrl || "";
    lesson.videoPublicId = first.videoPublicId || "";
    lesson.videoType = first.videoType || "";
    if (!lesson.durationMinutes && first.durationMinutes) {
      lesson.durationMinutes = first.durationMinutes;
    }
  }

  return lesson;
}

export function lessonHasVideo(lesson) {
  if (!lesson) return false;
  if (Array.isArray(lesson.videos) && lesson.videos.some((v) => v?.videoUrl)) {
    return true;
  }
  return Boolean(lesson.videoUrl);
}

/**
 * Publish rules:
 * - ≥1 module
 * - ≥1 lesson
 * - every lesson has ≥1 video
 */
export function getPublishReadiness(course) {
  const modules = course?.modules || [];
  const issues = [];

  if (!modules.length) {
    issues.push("Add at least one module");
  }

  let lessonCount = 0;
  let lessonsMissingVideo = 0;
  let videoCount = 0;

  for (const mod of modules) {
    for (const lesson of mod.lessons || []) {
      lessonCount += 1;
      if (lessonHasVideo(lesson)) {
        const n =
          Array.isArray(lesson.videos) && lesson.videos.length
            ? lesson.videos.filter((v) => v?.videoUrl).length
            : lesson.videoUrl
              ? 1
              : 0;
        videoCount += n;
      } else {
        lessonsMissingVideo += 1;
      }
    }
  }

  if (lessonCount === 0) {
    issues.push("Add at least one lesson inside a module");
  }
  if (lessonsMissingVideo > 0) {
    issues.push(
      `${lessonsMissingVideo} lesson${lessonsMissingVideo === 1 ? "" : "s"} missing a video — each lesson needs at least one video`
    );
  }
  if (videoCount === 0 && lessonCount > 0) {
    issues.push("Upload at least one video before publishing");
  }

  return {
    canPublish: issues.length === 0,
    issues,
    moduleCount: modules.length,
    lessonCount,
    videoCount,
    lessonsMissingVideo,
  };
}
