import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI);
const courses = await mongoose.connection.collection("courses").find({}).toArray();
let fixed = 0;

for (const c of courses) {
  const enrolls = await mongoose.connection
    .collection("enrollments")
    .find({ course: c._id })
    .toArray();
  const ids = enrolls.map((e) => e.student);
  await mongoose.connection.collection("courses").updateOne(
    { _id: c._id },
    { $set: { enrolledUserIds: ids, studentsCount: ids.length } },
  );
  if (ids.length) fixed += 1;
}

console.log(`Synced courses with enrollments: ${fixed} of ${courses.length}`);
const sample = await mongoose.connection.collection("courses").findOne(
  { _id: new mongoose.Types.ObjectId("6a5d5abbd4a4814f767bfeee") },
  { projection: { title: 1, enrolledUserIds: 1, studentsCount: 1 } },
);
console.log(JSON.stringify(sample, null, 2));
await mongoose.disconnect();
