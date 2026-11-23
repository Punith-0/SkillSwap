import { pool, rows, transaction, utc } from "../server/db.js";
import { createAccount } from "../server/auth.js";
if (process.env.LOCAL_DEMO !== "true")
  throw Error("Demo seed is only allowed in LOCAL_DEMO mode");
const examples = [
  [
    "maya",
    "Maya Shah",
    "Design",
    "Figma fundamentals",
    "Design",
    "Build your first polished interface. Learn frames, auto layout and components with a hands-on mini project.",
    "Online",
  ],
  [
    "arjun",
    "Arjun Rao",
    "Computer Science",
    "React, one component at a time",
    "Technology",
    "Understand components, props and state by building a tiny interactive app together. Bring your curiosity.",
    "Online",
  ],
  [
    "sara",
    "Sara Thomas",
    "Arts & Humanities",
    "Guitar for absolute beginners",
    "Music",
    "Learn your first three chords, find your rhythm and leave with a song you can actually play.",
    "Campus",
  ],
  [
    "dev",
    "Dev Kapoor",
    "Computer Science",
    "SQL that makes sense",
    "Technology",
    "Turn confusing joins into clear ideas. Practice queries on a small database and learn how tables fit together.",
    "Online",
  ],
  [
    "ananya",
    "Ananya Iyer",
    "Languages",
    "Conversational French",
    "Languages",
    "Start a real conversation. Practice introductions, everyday phrases and pronunciation in a relaxed session.",
    "Campus",
  ],
  [
    "kabir",
    "Kabir Mehta",
    "Business Studies",
    "Present with confidence",
    "Life skills",
    "Shape a clear story, simplify your slides and practice speaking with feedback that helps you grow.",
    "Online",
  ],
];
try {
  for (let i = 0; i < examples.length; i++) {
    const [slug, name, dept, skill, cat, description, mode] = examples[i];
    await transaction(async (c) => {
      const u = await createAccount(c, slug + "@skillswap.example", {
        display_name: name,
        department: dept,
      });
      await rows("UPDATE users SET age=21,college='Demo Campus',study_year='Year 3',interests=?,learning_goals=?,bio='Fictional profile for local testing.',onboarded=1,is_demo=1 WHERE id=?",[cat,skill,u.id],c);
      await rows(
        "INSERT IGNORE INTO skills(name,category) VALUES(?,?)",
        [skill, cat],
        c,
      );
      const [s] = await rows("SELECT id FROM skills WHERE name=?", [skill], c);
      await rows(
        "INSERT IGNORE INTO offers(teacher_id,skill_id,level,mode,description) VALUES(?,?,'Beginner',?,?)",
        [u.id, s.id, mode, description],
        c,
      );
      const [o] = await rows(
        "SELECT id FROM offers WHERE teacher_id=? AND skill_id=?",
        [u.id, s.id],
        c,
      );
      const [n] = await rows(
        "SELECT COUNT(*) AS n FROM availability_slots WHERE offer_id=? AND start_at>UTC_TIMESTAMP()",
        [o.id],
        c,
      );
      if (!n.n)
        for (let j = 1; j <= 3; j++) {
          const start = Date.now() + j * 86400000 + i * 3600000;
          await rows(
            "INSERT INTO availability_slots(offer_id,start_at,end_at) VALUES(?,?,?)",
            [o.id, utc(start), utc(start + 3600000)],
            c,
          );
        }
    });
  }
  console.log(
    "Six fictional demo teachers and their available slots are ready.",
  );
} finally {
  await pool.end();
}
