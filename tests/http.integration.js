import assert from "node:assert/strict";
import { rows, pool, utc } from "../server/db.js";
const tag = Date.now(),
  people = [],
  offerIds = [];
function client() {
  let cookie = "",
    csrf = "";
  return {
    async call(path, body, method = body ? "POST" : "GET") {
      const r = await fetch("http://127.0.0.1:8790/api" + path, {
        method,
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const data = await r.json();
      if (path === "/session") csrf = data.csrf;
      return { status: r.status, data };
    },
  };
}
async function register(name) {
  const c = client(),
    initial = await c.call("/session");
  assert.equal(initial.data.demo, true);
  const sent = await c.call("/auth/request", {
    email: `http-${tag}-${name}@tests.invalid`,
    profile: { display_name: "HTTP test " + name, department: "QA" },
    captcha_token: "local-preview",
  });
  assert.equal(sent.status, 200, JSON.stringify(sent));
  const wrong = sent.data.preview_code === "000000" ? "000001" : "000000";
  assert.equal(
    (
      await c.call("/auth/verify", {
        challenge_id: sent.data.challenge_id,
        code: wrong,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await c.call("/auth/verify", {
        challenge_id: sent.data.challenge_id,
        code: sent.data.preview_code,
      })
    ).status,
    200,
  );
  const s = await c.call("/session");
  people.push(s.data.user.id);
  c.id = s.data.user.id;
  assert.equal((await c.call('/offers')).status,428,'First visit requires complete profile');
  assert.equal((await c.call('/me',{display_name:'Missing fields'},'PATCH')).status,400);
  assert.equal((await c.call('/me',{display_name:'HTTP test '+name,age:21,college:'Test Campus',department:'Computer Science',study_year:'Year 3',bio:'API fixture',interests:'React, SQL',learning_goals:'SQL queries',preferred_mode:'Online'},'PATCH')).status,200);
  return c;
}
try {
  const teacher = await register("teacher"),
    learner = await register("learner"),
    outsider = await register("outsider");
  let r = await teacher.call("/offers", {
    name: "HTTP test " + tag,
    category: "Technology",
    level: "Beginner",
    mode: "Online",
    description: "An isolated end-to-end API verification lesson.",
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  const oid = r.data.id;
  offerIds.push(oid);
  const start = Date.now() + 3600000;
  r = await teacher.call(`/offers/${oid}/slots`, {
    start_at: new Date(start).toISOString(),
  });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await teacher.call(`/offers/${oid}/slots`, {
        start_at: new Date(start + 1000).toISOString(),
      })
    ).status,
    409,
    "Overlapping slots blocked",
  );
  const slots = await learner.call(`/offers/${oid}/slots`);
  const slot = slots.data[0].id;
  r = await learner.call("/sessions", { slot_id: slot });
  assert.equal(r.status, 201);
  const sid = r.data.id;
  assert.equal(
    (
      await outsider.call(`/sessions/${sid}/accept`, {
        location: "secret test room",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await teacher.call(`/sessions/${sid}/accept`, {
        location: "secret test room",
      })
    ).status,
    200,
  );
  const privateList = await outsider.call("/sessions");
  assert.ok(!JSON.stringify(privateList.data).includes("secret test room"));
  assert.equal((await learner.call("/wallet")).data.wallet.available, 2);
  await rows("UPDATE availability_slots SET start_at=?,end_at=? WHERE id=?", [
    utc(Date.now() - 7200000),
    utc(Date.now() - 3600000),
    slot,
  ]);
  assert.equal(
    (await learner.call(`/sessions/${sid}/confirm`, {})).status,
    200,
  );
  assert.equal(
    (await teacher.call(`/sessions/${sid}/confirm`, {})).status,
    200,
  );
  assert.equal(
    (
      await learner.call("/reviews", {
        session_id: sid,
        rating: 5,
        text: "Test review",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await learner.call("/reviews", {
        session_id: sid,
        rating: 4,
        text: "Duplicate",
      })
    ).status,
    409,
  );
  assert.equal((await teacher.call("/wallet")).data.wallet.balance, 4);
  assert.equal((await learner.call("/wallet")).data.wallet.held_balance, 0);
  assert.equal((await learner.call("/admin/reports")).status, 403);
  assert.equal((await learner.call("/github/status")).status, 404,'GitHub belongs to the hub now');
  const publicProfile=await learner.call('/people/'+teacher.id);
  assert.equal(publicProfile.status,200);assert.ok(!('email' in publicProfile.data));assert.ok(!('age' in publicProfile.data));
  const file=await teacher.call('/me/media',{kind:'document',title:'Example notes',mime:'application/pdf',data:Buffer.from('%PDF-1.4\nTest document').toString('base64')});
  assert.equal(file.status,201,JSON.stringify(file));
  assert.equal((await outsider.call('/me/media/'+file.data.id,undefined,'DELETE')).status,404);
  assert.equal((await teacher.call('/me/media',{kind:'avatar',title:'Bad file',mime:'image/png',data:Buffer.from('<script>bad</script>').toString('base64')})).status,400);
  assert.equal((await learner.call('/people/'+teacher.id)).data.media.length,1);
  assert.equal((await teacher.call('/me/media/'+file.data.id,undefined,'DELETE')).status,200);
  assert.equal((await learner.call('/recommendations')).status,200);
  assert.equal((await learner.call('/admin/skills/bulk',{items:[]})).status,403);
  await rows("UPDATE users SET role='admin' WHERE id=?",[teacher.id]);
  const bulk=await teacher.call('/admin/skills/bulk',{items:[{user_id:teacher.id,name:'HTTP test '+tag,category:'Technology',level:'Advanced',mode:'Online',description:'Updated through the bulk admin skill editor.'}]});
  assert.equal(bulk.status,200,JSON.stringify(bulk));
  assert.equal((await teacher.call('/admin/logs')).status,200);
  await rows("INSERT INTO learning_challenges(user_id,title,due_at) VALUES(?,'HTTP challenge',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 72 HOUR))",[learner.id]);
  const ch=(await learner.call('/challenges')).data.challenge;
  const video={mime:'video/mp4',data:Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom0000000000000000')]).toString('base64')};
  assert.equal((await outsider.call(`/challenges/${ch.id}/submit`,video)).status,404);
  assert.equal((await learner.call(`/challenges/${ch.id}/submit`,{mime:'video/mp4',data:Buffer.from('this is not a video file').toString('base64')})).status,400);
  assert.equal((await learner.call(`/challenges/${ch.id}/submit`,video)).status,200);
  assert.equal((await learner.call('/challenges')).data.challenge.status,'SUBMITTED');
  assert.equal((await learner.call(`/admin/challenges/${ch.id}/review`,{decision:'APPROVE',note:'Not an admin'})).status,403);
  assert.equal((await teacher.call(`/admin/challenges/${ch.id}/review`,{decision:'EXTEND',note:'Another attempt allowed'})).status,200);
  await rows("UPDATE learning_challenges SET due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[ch.id]);
  assert.equal((await learner.call('/offers')).status,423);
  assert.equal((await learner.call(`/challenges/${ch.id}/submit`,video)).status,200);
  assert.equal((await learner.call('/challenges')).data.challenge.status,'OVERDUE');
  assert.equal((await teacher.call(`/admin/challenges/${ch.id}/review`,{decision:'APPROVE',note:'Teaching submission reviewed'})).status,200);
  assert.equal((await learner.call('/offers')).status,200);
  console.log('PASS: challenge upload ownership, invalid media, timely submission, late suspension, extension, admin-only approval and restored access.');
  console.log(
    "PASS: real HTTP registration, bad OTP, rotation, skill creation, overlap denial, booking, ownership, meeting privacy, completion, reviews, credit ledger and admin restrictions.",
  );
} finally {
  if (people.length) {
    const marks = people.map(() => "?").join(",");
    const ss = await rows(
      `SELECT id FROM sessions WHERE learner_id IN (${marks})`,
      people,
    );
    if (ss.length) {
      const sm = ss.map(() => "?").join(","),
        si = ss.map((x) => x.id);
      for (const table of [
        "reviews",
        "disputes",
        "completion_confirmations",
        "credit_holds",
        "credit_transfers",
      ])
        await rows(`DELETE FROM ${table} WHERE session_id IN (${sm})`, si);
      await rows(`DELETE FROM sessions WHERE id IN (${sm})`, si);
    }
    for (const oid of offerIds)
      await rows("DELETE FROM availability_slots WHERE offer_id=?", [oid]);
    const sk = await rows(
      `SELECT skill_id FROM offers WHERE teacher_id IN (${marks})`,
      people,
    );
    await rows(`DELETE FROM offers WHERE teacher_id IN (${marks})`, people);
    for (const s of sk)
      await rows("DELETE FROM skills WHERE id=?", [s.skill_id]);
    for (const table of [
      "audit_events",
      "credit_transfers",
      "wallets",
      "web_sessions",
      "profile_media",
    ]) {
      const key = {
        audit_events: "actor_id",
        credit_transfers: "payee_id",
        wallets: "user_id",
        web_sessions: "user_id",
        profile_media: "user_id",
      }[table];
      await rows(`DELETE FROM ${table} WHERE ${key} IN (${marks})`, people);
    }
    await rows(`DELETE v FROM challenge_videos v JOIN learning_challenges c ON c.id=v.challenge_id WHERE c.user_id IN (${marks})`,people);
    await rows(`DELETE FROM learning_challenges WHERE user_id IN (${marks})`,people);
    await rows(`DELETE FROM users WHERE id IN (${marks})`, people);
  }
  await pool.end();
}
