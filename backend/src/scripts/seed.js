import "dotenv/config";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Category from "../models/Category.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Coupon from "../models/Coupon.js";
import Quiz from "../models/Quiz.js";
import { Channel, ChannelMessage } from "../models/Channel.js";
import Wishlist from "../models/Wishlist.js";
import Certificate from "../models/Certificate.js";
import Payment from "../models/Payment.js";
import PlatformSettings from "../models/PlatformSettings.js";
import Review from "../models/Review.js";
import { buildCourseSearchText } from "../utils/pricing.js";

const PASS = "Password123!";

const SAMPLE_YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const thumbs = {
  ts: "https://images.unsplash.com/photo-1516116216624-53e697fedbea?q=80&w=800&auto=format&fit=crop",
  figma: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=800&auto=format&fit=crop",
  data: "https://images.unsplash.com/photo-1555949963-aa79dcee981c?q=80&w=800&auto=format&fit=crop",
  react: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?q=80&w=800&auto=format&fit=crop",
  marketing: "https://images.unsplash.com/photo-1552664730-d307ca884978?q=80&w=800&auto=format&fit=crop",
  ux: "https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?q=80&w=800&auto=format&fit=crop",
};

async function upsertUser({ name, email, role, password = PASS }) {
  let user = await User.findOne({ email }).select("+password");
  if (!user) {
    user = await User.create({ name, email, password, role });
  } else {
    user.name = name;
    user.role = role;
    user.password = password;
    await user.save();
  }
  return user;
}

function modulesFor(title) {
  return [
    {
      title: "Getting Started",
      order: 0,
      lessons: [
        {
          title: `Welcome to ${title}`,
          content: `Introduction and overview of ${title}. Learn core ideas and outcomes.`,
          videoUrl: SAMPLE_YT,
          videoType: "youtube",
          durationMinutes: 12,
          order: 0,
          isPreview: true,
        },
        {
          title: "Setup & tools",
          content: "Install required tools and configure your workspace.",
          videoUrl: SAMPLE_YT,
          videoType: "youtube",
          durationMinutes: 18,
          order: 1,
        },
      ],
    },
    {
      title: "Core Concepts",
      order: 1,
      lessons: [
        {
          title: "Fundamentals deep dive",
          content: `Deep dive into the fundamentals of ${title} with practical examples.`,
          videoUrl: SAMPLE_YT,
          videoType: "youtube",
          durationMinutes: 25,
          order: 0,
        },
        {
          title: "Hands-on project",
          content: "Build a small project applying what you learned.",
          videoUrl: SAMPLE_YT,
          videoType: "youtube",
          durationMinutes: 40,
          order: 1,
        },
      ],
    },
  ];
}

const seed = async () => {
  await connectDB();
  console.log("Seeding sample LMS data…");

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@skillbridge.com").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin12345!";

  await User.updateMany(
    { role: "admin", email: { $ne: adminEmail } },
    { $set: { role: "student" } }
  );

  const admin = await upsertUser({
    name: "Platform Admin",
    email: adminEmail,
    role: "admin",
    password: adminPassword,
  });
  // Ensure password for known demo admin if newly created only — leave existing
  console.log(`Admin: ${admin.email}`);

  const cats = {};
  for (const c of [
    { name: "Development", slug: "development" },
    { name: "Design", slug: "design" },
    { name: "Data", slug: "data" },
    { name: "Business", slug: "business" },
    { name: "Marketing", slug: "marketing" },
  ]) {
    cats[c.slug] = await Category.findOneAndUpdate(
      { slug: c.slug },
      c,
      { upsert: true, returnDocument: "after" }
    );
  }

  const sarah = await upsertUser({
    name: "Sarah Lin",
    email: "sarah@skillbridge.com",
    role: "instructor",
  });
  const marco = await upsertUser({
    name: "Marco Reyes",
    email: "marco@skillbridge.com",
    role: "instructor",
  });
  const priya = await upsertUser({
    name: "Priya Nair",
    email: "priya@skillbridge.com",
    role: "instructor",
  });

  const alex = await upsertUser({
    name: "Alex Smith",
    email: "alex@skillbridge.com",
    role: "student",
  });
  const aisha = await upsertUser({
    name: "Aisha Khan",
    email: "aisha@skillbridge.com",
    role: "student",
  });
  const liam = await upsertUser({
    name: "Liam Park",
    email: "liam@skillbridge.com",
    role: "student",
  });

  const courseDefs = [
    {
      key: "ts",
      title: "Advanced TypeScript",
      instructor: sarah,
      category: cats.development,
      price: 79,
      thumb: thumbs.ts,
      tags: ["typescript", "javascript", "types"],
      shortDescription: "Master advanced TypeScript patterns for production apps.",
    },
    {
      key: "figma",
      title: "Design Systems with Figma",
      instructor: marco,
      category: cats.design,
      price: 49,
      thumb: thumbs.figma,
      tags: ["figma", "design-systems", "ui"],
      shortDescription: "Build scalable design systems in Figma.",
    },
    {
      key: "data",
      title: "Data Science 101",
      instructor: priya,
      category: cats.data,
      price: 59,
      thumb: thumbs.data,
      tags: ["python", "pandas", "ml"],
      shortDescription: "Start your data science journey with Python.",
    },
    {
      key: "react",
      title: "React Performance",
      instructor: sarah,
      category: cats.development,
      price: 69,
      thumb: thumbs.react,
      tags: ["react", "performance", "frontend"],
      shortDescription: "Make React apps fast with profiling and memoization.",
    },
    {
      key: "mkt",
      title: "Product Marketing Mastery",
      instructor: marco,
      category: cats.marketing,
      price: 45,
      thumb: thumbs.marketing,
      tags: ["marketing", "growth", "positioning"],
      shortDescription: "Launch and grow products with modern marketing.",
    },
    {
      key: "ux",
      title: "UX Research Sprint",
      instructor: marco,
      category: cats.design,
      price: 39,
      thumb: thumbs.ux,
      tags: ["ux", "research", "interviews"],
      shortDescription: "Run a complete UX research sprint in one week.",
    },
  ];

  const courses = {};
  for (const def of courseDefs) {
    const slugBase = def.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let course = await Course.findOne({
      title: def.title,
      instructor: def.instructor._id,
    });
    const payload = {
      title: def.title,
      slug: course?.slug || `${slugBase}-demo`,
      description: `${def.shortDescription} This demo course includes modules, lessons, quizzes, and a class channel.`,
      shortDescription: def.shortDescription,
      instructor: def.instructor._id,
      category: def.category._id,
      thumbnail: { url: def.thumb },
      price: def.price,
      level: "intermediate",
      status: "published",
      modules: modulesFor(def.title),
      tags: def.tags,
      rating: 0,
      ratingCount: 0,
      studentsCount: 0,
    };
    payload.searchText = buildCourseSearchText(payload);

    if (course) {
      Object.assign(course, payload);
      await course.save();
    } else {
      course = await Course.create(payload);
    }
    courses[def.key] = course;
  }
  console.log(`Courses: ${Object.keys(courses).length}`);

  // Coupons
  await Coupon.findOneAndUpdate(
    { code: "TS20" },
    {
      code: "TS20",
      type: "course",
      percentOff: 20,
      course: courses.ts._id,
      createdBy: sarah._id,
      isActive: true,
      maxUses: 100,
    },
    { upsert: true }
  );
  await Coupon.findOneAndUpdate(
    { code: "FIGMA15" },
    {
      code: "FIGMA15",
      type: "course",
      percentOff: 15,
      course: courses.figma._id,
      createdBy: marco._id,
      isActive: true,
    },
    { upsert: true }
  );
  await Coupon.findOneAndUpdate(
    { code: "DEV10", },
    {
      code: "DEV10",
      type: "category",
      percentOff: 10,
      category: cats.development._id,
      createdBy: admin._id,
      isActive: true,
    },
    { upsert: true }
  );
  await Coupon.findOneAndUpdate(
    { code: "DESIGN25" },
    {
      code: "DESIGN25",
      type: "category",
      percentOff: 25,
      category: cats.design._id,
      createdBy: admin._id,
      isActive: true,
    },
    { upsert: true }
  );
  console.log("Coupons ready (TS20, FIGMA15, DEV10, DESIGN25)");

  // Enrollments for Alex
  const enrollPairs = [
    { student: alex, course: courses.ts, progress: 72 },
    { student: alex, course: courses.figma, progress: 40 },
    { student: alex, course: courses.data, progress: 100 },
    { student: alex, course: courses.react, progress: 18 },
    { student: aisha, course: courses.ts, progress: 55 },
    { student: aisha, course: courses.ux, progress: 30 },
    { student: liam, course: courses.react, progress: 90 },
    { student: liam, course: courses.mkt, progress: 10 },
  ];

  for (const e of enrollPairs) {
    const enrollment = await Enrollment.findOneAndUpdate(
      { student: e.student._id, course: e.course._id },
      {
        student: e.student._id,
        course: e.course._id,
        progress: e.progress,
        pricePaid: e.course.price,
        completedAt: e.progress >= 100 ? new Date() : undefined,
        completedLessons:
          e.progress >= 50
            ? [(e.course.modules?.[0]?.lessons?.[0]?._id || "l1").toString()]
            : [],
      },
      { upsert: true, returnDocument: "after" }
    );

    let channel = await Channel.findOne({ course: e.course._id });
    if (!channel) {
      channel = await Channel.create({
        course: e.course._id,
        name: `${e.course.title} · Class Channel`,
      });
    }

    if (e.progress >= 100) {
      await Certificate.findOneAndUpdate(
        { student: e.student._id, course: e.course._id },
        {
          student: e.student._id,
          course: e.course._id,
          code: `SB-${enrollment._id.toString().slice(-8).toUpperCase()}`,
          issuedAt: new Date(),
        },
        { upsert: true }
      );
    }
  }

  // Refresh student counts
  for (const c of Object.values(courses)) {
    c.studentsCount = await Enrollment.countDocuments({ course: c._id });
    await c.save();
  }

  // Reviews — only from enrolled students
  const reviewDefs = [
    {
      student: alex,
      course: courses.ts,
      rating: 5,
      comment: "Excellent TypeScript deep dive. Modules and videos are clear and practical.",
    },
    {
      student: aisha,
      course: courses.ts,
      rating: 4,
      comment: "Great pacing. Would love more advanced generics examples.",
    },
    {
      student: alex,
      course: courses.figma,
      rating: 5,
      comment: "Design systems content is gold. Preview lesson hooked me instantly.",
    },
    {
      student: liam,
      course: courses.react,
      rating: 4,
      comment: "Solid performance tips. The hands-on project module was my favorite.",
    },
  ];

  for (const r of reviewDefs) {
    await Review.findOneAndUpdate(
      { student: r.student._id, course: r.course._id },
      {
        student: r.student._id,
        course: r.course._id,
        rating: r.rating,
        comment: r.comment,
      },
      { upsert: true }
    );
  }

  for (const c of Object.values(courses)) {
    const stats = await Review.aggregate([
      { $match: { course: c._id } },
      { $group: { _id: "$course", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    if (stats[0]) {
      c.rating = Math.round(stats[0].avg * 10) / 10;
      c.ratingCount = stats[0].count;
    } else {
      c.rating = 0;
      c.ratingCount = 0;
    }
    await c.save();
  }
  console.log("Reviews seeded for enrolled students");

  // Channel welcome messages
  for (const c of [courses.ts, courses.figma, courses.data]) {
    const channel = await Channel.findOne({ course: c._id });
    if (!channel) continue;
    const count = await ChannelMessage.countDocuments({ channel: channel._id });
    if (count === 0) {
      await ChannelMessage.create({
        channel: channel._id,
        sender: c.instructor,
        body: `Welcome to the ${c.title} class channel! Ask questions and share wins here.`,
      });
      await ChannelMessage.create({
        channel: channel._id,
        sender: alex._id,
        body: "Excited to learn with everyone — posting my notes after each lesson.",
      });
    }
  }

  // Quizzes
  const quizPayload = (title, courseId, creatorId) => ({
    title,
    course: courseId,
    createdBy: creatorId,
    status: "published",
    passScore: 70,
    timeLimitMinutes: 20,
    sourceType: "manual",
    questions: [
      {
        type: "mcq",
        prompt: `What is a core benefit of studying ${title}?`,
        options: ["Faster learning", "Random guessing", "Skipping practice", "Ignoring docs"],
        answerIndex: 0,
        explanation: "Structured learning accelerates mastery.",
      },
      {
        type: "mcq",
        prompt: "Which practice helps retention most?",
        options: ["Passive watching only", "Hands-on projects", "Never reviewing", "Skipping quizzes"],
        answerIndex: 1,
        explanation: "Active practice builds durable skills.",
      },
      {
        type: "mcq",
        prompt: "Best way to get help in this course?",
        options: ["Stay silent", "Use the class channel", "Quit", "Guess forever"],
        answerIndex: 1,
        explanation: "The class channel is for enrolled learners.",
      },
    ],
  });

  await Quiz.findOneAndUpdate(
    { title: "TypeScript Fundamentals Check", course: courses.ts._id },
    quizPayload("TypeScript Fundamentals Check", courses.ts._id, sarah._id),
    { upsert: true }
  );
  await Quiz.findOneAndUpdate(
    { title: "Figma Systems Quiz", course: courses.figma._id },
    quizPayload("Figma Systems Quiz", courses.figma._id, marco._id),
    { upsert: true }
  );
  await Quiz.findOneAndUpdate(
    { title: "Data Science Basics", course: courses.data._id },
    quizPayload("Data Science Basics", courses.data._id, priya._id),
    { upsert: true }
  );

  // Wishlist
  await Wishlist.findOneAndUpdate(
    { student: alex._id, course: courses.mkt._id },
    { student: alex._id, course: courses.mkt._id },
    { upsert: true }
  );
  await Wishlist.findOneAndUpdate(
    { student: alex._id, course: courses.ux._id },
    { student: alex._id, course: courses.ux._id },
    { upsert: true }
  );

  // Sample paid payments
  const payExists = await Payment.findOne({ stripeSessionId: "seed_session_ts" });
  if (!payExists) {
    await Payment.create({
      student: alex._id,
      instructor: sarah._id,
      course: courses.ts._id,
      amountTotal: 79,
      platformFee: 15.8,
      instructorAmount: 63.2,
      status: "paid",
      stripeSessionId: "seed_session_ts",
    });
    await Payment.create({
      student: aisha._id,
      instructor: marco._id,
      course: courses.figma._id,
      amountTotal: 41.65,
      platformFee: 8.33,
      instructorAmount: 33.32,
      couponCode: "FIGMA15",
      status: "paid",
      stripeSessionId: "seed_session_figma",
    });
  }

  const settings = await PlatformSettings.getSettings();
  settings.platformFeePercent = 20;
  await settings.save();

  console.log("\n=== Demo logins (password: Password123! except admin) ===");
  console.log(`Admin:      ${adminEmail} / ${adminPassword}`);
  console.log("Instructor: sarah@skillbridge.com / Password123!");
  console.log("Instructor: marco@skillbridge.com / Password123!");
  console.log("Student:    alex@skillbridge.com / Password123!");
  console.log("Student:    aisha@skillbridge.com / Password123!");
  console.log("Coupons:    TS20, FIGMA15, DEV10, DESIGN25");
  console.log("Seed complete.");
  process.exit(0);
};

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
