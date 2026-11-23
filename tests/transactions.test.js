import {refreshChallenge,challengeGate} from '../server/challenges.js';
import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, rows, transaction, utc } from "../server/db.js";
import { createAccount } from "../server/auth.js";
import {
  requestSession,
  actSession,
  resolveDispute,
} from "../server/sessions.js";
const users = [],
  skills = [];
async function fixture() {
  const tag = crypto.randomBytes(7).toString("hex");
  const ids = await transaction(async (c) => {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const u = await createAccount(c, `${tag}-${i}@tests.invalid`, {
        display_name: "Isolated transaction test",
      });
      users.push(u.id);
      ids.push(u.id);
    }
    const sk = await rows(
      "INSERT INTO skills(name,category) VALUES(?,?)",
      ["Test " + tag, "Technology"],
      c,
    );
    skills.push(sk.insertId);
    const o = await rows(
      "INSERT INTO offers(teacher_id,skill_id,level,mode,description) VALUES(?,?,'Beginner','Online','Isolated test offer')",
      [ids[0], sk.insertId],
      c,
    );
    const s = await rows(
      "INSERT INTO availability_slots(offer_id,start_at,end_at) VALUES(?,?,?)",
      [o.insertId, utc(Date.now() + 86400000), utc(Date.now() + 90000000)],
      c,
    );
    return {
      teacher: ids[0],
      a: ids[1],
      b: ids[2],
      admin: ids[3],
      slot: s.insertId,
      offer: o.insertId,
    };
  });
  return ids;
}
test('zero available credits block requests and paused offers cannot be accepted',async()=>{
  const f=await fixture();
  await rows('UPDATE wallets SET held_balance=balance WHERE user_id=?',[f.a]);
  await assert.rejects(requestSession(f.a,f.slot),/one available credit/);
  await rows('UPDATE wallets SET held_balance=0 WHERE user_id=?',[f.a]);
  const request=await requestSession(f.a,f.slot);
  await rows('UPDATE offers SET active=0 WHERE id=?',[f.offer]);
  await assert.rejects(actSession(f.teacher,request.id,'accept',{location:'Test room'}),/Slot unavailable/);
  assert.equal((await rows('SELECT held_balance FROM wallets WHERE user_id=?',[f.a]))[0].held_balance,0);
});
test("concurrent accepts have one winner, one hold, and one occupied slot", async () => {
  const f = await fixture(),
    a = await requestSession(f.a, f.slot),
    b = await requestSession(f.b, f.slot);
  const result = await Promise.allSettled([
    actSession(f.teacher, a.id, "accept", { location: "Test room" }),
    actSession(f.teacher, b.id, "accept", { location: "Test room" }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const [count] = await rows(
    "SELECT COUNT(*) n FROM sessions WHERE slot_id=? AND status='CONFIRMED'",
    [f.slot],
  );
  assert.equal(count.n, 1);
  const [held] = await rows(
    "SELECT SUM(held_balance) n FROM wallets WHERE user_id IN (?,?)",
    [f.a, f.b],
  );
  assert.equal(held.n, 1);
});
test("completion retries settle exactly once and conserve posted credits", async () => {
  const f = await fixture(),
    s = await requestSession(f.a, f.slot);
  await actSession(f.teacher, s.id, "accept", { location: "Test room" });
  await rows("UPDATE availability_slots SET start_at=?,end_at=? WHERE id=?", [
    utc(Date.now() - 7200000),
    utc(Date.now() - 3600000),
    f.slot,
  ]);
  await actSession(f.a, s.id, "confirm");
  await Promise.all([
    actSession(f.teacher, s.id, "confirm"),
    actSession(f.teacher, s.id, "confirm"),
  ]);
  const [n] = await rows(
    "SELECT COUNT(*) n FROM credit_transfers WHERE session_id=?",
    [s.id],
  );
  assert.equal(n.n, 1);
  const w = await rows(
    "SELECT balance,held_balance FROM wallets WHERE user_id IN (?,?) ORDER BY user_id",
    [f.teacher, f.a],
  );
  assert.equal(
    w.reduce((n, x) => n + x.balance, 0),
    6,
  );
  assert.equal(w[0].balance, 4);
  assert.equal(w[1].held_balance, 0);
});
test("cancellation releases a hold once and unauthorized actors are rejected", async () => {
  const f = await fixture(),
    s = await requestSession(f.a, f.slot);
  await assert.rejects(
    actSession(f.b, s.id, "accept", { location: "Test room" }),
  );
  await actSession(f.teacher, s.id, "accept", { location: "Test room" });
  await actSession(f.a, s.id, "cancel");
  await actSession(f.a, s.id, "cancel");
  const [w] = await rows("SELECT * FROM wallets WHERE user_id=?", [f.a]);
  assert.equal(w.balance, 3);
  assert.equal(w.held_balance, 0);
});
test("one available credit cannot fund two nonoverlapping accepted requests", async () => {
  const f = await fixture();
  await rows("UPDATE wallets SET held_balance=2 WHERE user_id=?", [f.a]);
  const slot2 = await rows(
    "INSERT INTO availability_slots(offer_id,start_at,end_at) VALUES(?,?,?)",
    [f.offer, utc(Date.now() + 172800000), utc(Date.now() + 176400000)],
  );
  const a = await requestSession(f.a, f.slot),
    b = await requestSession(f.a, slot2.insertId);
  const r = await Promise.allSettled([
    actSession(f.teacher, a.id, "accept", { location: "Test" }),
    actSession(f.teacher, b.id, "accept", { location: "Test" }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  const [w] = await rows("SELECT * FROM wallets WHERE user_id=?", [f.a]);
  assert.equal(w.held_balance, 3);
});
test("disputed sessions require an administrator and preserve reason and ledger", async () => {
  const f = await fixture(),
    s = await requestSession(f.a, f.slot);
  await actSession(f.teacher, s.id, "accept", { location: "Test room" });
  await actSession(f.a, s.id, "dispute", {
    reason: "Teacher could not attend the session.",
  });
  await assert.rejects(actSession(f.teacher, s.id, "confirm"));
  await assert.rejects(
    resolveDispute(f.a, s.id, "CANCEL", "Cancel because no lesson occurred."),
  );
  await rows("UPDATE users SET role='admin' WHERE id=?", [f.admin]);
  await resolveDispute(
    f.admin,
    s.id,
    "CANCEL",
    "Cancel because no lesson occurred.",
  );
  const [d] = await rows("SELECT * FROM disputes WHERE session_id=?", [s.id]);
  assert.equal(d.status, "RESOLVED");
  assert.equal(d.resolved_by, f.admin);
  const [w] = await rows("SELECT * FROM wallets WHERE user_id=?", [f.a]);
  assert.equal(w.balance, 3);
  assert.equal(w.held_balance, 0);
});
test("duplicate pending requests and self-booking are rejected", async () => {
  const f = await fixture();
  await assert.rejects(requestSession(f.teacher, f.slot));
  await requestSession(f.a, f.slot);
  await assert.rejects(requestSession(f.a, f.slot));
});
test('third settled learning credit starts one 72-hour challenge; deadline gates SkillSwap',async()=>{
 const f=await fixture();await rows('UPDATE users SET onboarded=1 WHERE id=?',[f.a]);
 assert.equal(await refreshChallenge(f.a),null);
 for(let i=0;i<3;i++){
  const slot=await rows('INSERT INTO availability_slots(offer_id,start_at,end_at) VALUES(?,?,?)',[f.offer,utc(Date.now()+(i+2)*86400000),utc(Date.now()+(i+2)*86400000+3600000)]);
  const session=await requestSession(f.a,slot.insertId);await actSession(f.teacher,session.id,'accept',{location:'Test room'});
  await rows('UPDATE availability_slots SET start_at=?,end_at=? WHERE id=?',[utc(Date.now()-7200000),utc(Date.now()-3600000),slot.insertId]);
  await actSession(f.a,session.id,'confirm');await actSession(f.teacher,session.id,'confirm');
 }
 const [created]=await rows('SELECT *,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),due_at) remaining FROM learning_challenges WHERE user_id=?',[f.a]);
 assert.equal(created.status,'OPEN');assert.ok(created.remaining>259180&&created.remaining<=259200);
 assert.equal((await refreshChallenge(f.a)).id,created.id);
 await rows("UPDATE learning_challenges SET due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?",[created.id]);
 await assert.rejects(challengeGate({session:{user_id:f.a,role:'member'},path:'/offers'},{},()=>{}),e=>e.status===423);
 let allowed=false;await challengeGate({session:{user_id:f.a,role:'member'},path:'/challenges'},{},()=>{allowed=true});assert.equal(allowed,true);
 await rows("UPDATE learning_challenges SET status='SUBMITTED' WHERE id=?",[created.id]);
 assert.equal((await refreshChallenge(f.a)).status,'SUBMITTED');
 await rows("UPDATE learning_challenges SET status='APPROVED' WHERE id=?",[created.id]);
 assert.equal((await refreshChallenge(f.a)).status,'APPROVED');
});
after(async () => {
  try {
    if (users.length) {
      const marks = users.map(() => "?").join(",");
      const ss = await rows(
        `SELECT id FROM sessions WHERE learner_id IN (${marks})`,
        users,
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
      await rows(
        `DELETE a FROM availability_slots a JOIN offers o ON o.id=a.offer_id WHERE o.teacher_id IN (${marks})`,
        users,
      );
      await rows(`DELETE FROM offers WHERE teacher_id IN (${marks})`, users);
      await rows(
        `DELETE FROM audit_events WHERE actor_id IN (${marks})`,
        users,
      );
      await rows(
        `DELETE FROM credit_transfers WHERE payee_id IN (${marks})`,
        users,
      );
      await rows(`DELETE v FROM challenge_videos v JOIN learning_challenges c ON c.id=v.challenge_id WHERE c.user_id IN (${marks})`,users);
      await rows(`DELETE FROM learning_challenges WHERE user_id IN (${marks})`,users);
      await rows(`DELETE FROM wallets WHERE user_id IN (${marks})`, users);
      await rows(`DELETE FROM users WHERE id IN (${marks})`, users);
      if (skills.length)
        await rows(
          `DELETE FROM skills WHERE id IN (${skills.map(() => "?").join(",")})`,
          skills,
        );
    }
  } finally {
    await pool.end();
  }
});
