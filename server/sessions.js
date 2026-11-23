import {ensureChallenge} from './challenges.js';
import {
  rows,
  transaction,
  lockUsers,
  requireThat,
  fromDb,
  audit,
} from "./db.js";
const joined = `SELECT s.*,a.start_at,a.end_at,a.offer_id,o.teacher_id FROM sessions s JOIN availability_slots a ON a.id=s.slot_id JOIN offers o ON o.id=a.offer_id WHERE s.id=?`;
export async function withSession(id, actor, fn) {
  return transaction(async (c) => {
    const [hint] = await rows(joined, [id], c);
    requireThat(hint, "Session not found", 404);
    await lockUsers(c, [hint.teacher_id, hint.learner_id]);
    const [s] = await rows(joined + " FOR UPDATE", [id], c);
    return fn(c, s);
  });
}
export async function overlap(c, ids, start, end, exclude = 0) {
  const result = await rows(
    `SELECT s.id FROM sessions s JOIN availability_slots a ON a.id=s.slot_id JOIN offers o ON o.id=a.offer_id WHERE s.status IN ('CONFIRMED','DISPUTED') AND s.id<>? AND (s.learner_id IN (?,?) OR o.teacher_id IN (?,?)) AND a.start_at<? AND a.end_at>? LIMIT 1`,
    [exclude, ids[0], ids[1], ids[0], ids[1], end, start],
    c,
  );
  return result.length > 0;
}
export async function requestSession(actor, slotId) {
  return transaction(async (c) => {
    const [hint] = await rows(
      "SELECT o.teacher_id FROM availability_slots a JOIN offers o ON o.id=a.offer_id WHERE a.id=?",
      [slotId],
      c,
    );
    requireThat(hint, "Slot not found", 404);
    requireThat(hint.teacher_id !== actor, "You cannot book your own skill");
    await lockUsers(c, [actor, hint.teacher_id]);
    const [wallet]=await rows('SELECT balance-held_balance AS available FROM wallets WHERE user_id=?',[actor],c);
    requireThat(wallet?.available>=1,'You need one available credit to request a session. Teach a skill to earn credits.',409);
    const [slot] = await rows(
      "SELECT a.*,o.active,u.active AS teacher_active FROM availability_slots a JOIN offers o ON o.id=a.offer_id JOIN users u ON u.id=o.teacher_id WHERE a.id=? FOR UPDATE",
      [slotId],
      c,
    );
    requireThat(
      slot.active &&
        slot.teacher_active &&
        slot.status === "AVAILABLE" &&
        fromDb(slot.start_at) > new Date(),
      "This slot is no longer available",
      409,
    );
    const result = await rows(
      "INSERT INTO sessions(slot_id,learner_id) VALUES(?,?)",
      [slotId, actor],
      c,
    );
    return { id: result.insertId };
  });
}
async function settle(c, s, actor) {
  if (s.status === "COMPLETED") return;
  for (const id of [s.teacher_id, s.learner_id].sort((a, b) => a - b))
    await rows(
      "SELECT user_id FROM wallets WHERE user_id=? FOR UPDATE",
      [id],
      c,
    );
  const [hold] = await rows(
    "SELECT * FROM credit_holds WHERE session_id=? FOR UPDATE",
    [s.id],
    c,
  );
  requireThat(hold?.status === "ACTIVE", "Credit hold is not active", 409);
  await rows(
    "INSERT INTO credit_transfers(session_id,payer_id,payee_id,amount,type,idempotency_key) VALUES(?,?,?,1,'SETTLEMENT',?)",
    [s.id, s.learner_id, s.teacher_id, `session:${s.id}`],
    c,
  );
  await rows(
    "UPDATE wallets SET balance=balance-1,held_balance=held_balance-1 WHERE user_id=?",
    [s.learner_id],
    c,
  );
  await rows(
    "UPDATE wallets SET balance=balance+1 WHERE user_id=?",
    [s.teacher_id],
    c,
  );
  await rows(
    "UPDATE credit_holds SET status='SETTLED' WHERE session_id=?",
    [s.id],
    c,
  );
  await rows("UPDATE sessions SET status='COMPLETED' WHERE id=?", [s.id], c);
  await ensureChallenge(c,s.learner_id);
  await audit(c, actor, "settled", s.id);
}
async function release(c, s, actor) {
  await rows(
    "SELECT user_id FROM wallets WHERE user_id=? FOR UPDATE",
    [s.learner_id],
    c,
  );
  const changed = await rows(
    "UPDATE credit_holds SET status='RELEASED' WHERE session_id=? AND status='ACTIVE'",
    [s.id],
    c,
  );
  if (changed.affectedRows)
    await rows(
      "UPDATE wallets SET held_balance=held_balance-1 WHERE user_id=?",
      [s.learner_id],
      c,
    );
  await rows("UPDATE sessions SET status='CANCELLED' WHERE id=?", [s.id], c);
  await rows(
    "UPDATE availability_slots a JOIN offers o ON o.id=a.offer_id SET a.status=IF(a.start_at>UTC_TIMESTAMP() AND o.active=1,'AVAILABLE','CLOSED') WHERE a.id=?",
    [s.slot_id],
    c,
  );
  await audit(c, actor, "cancelled", s.id);
}
export async function actSession(actor, id, action, data = {}) {
  return withSession(id, actor, async (c, s) => {
    requireThat(
      [s.teacher_id, s.learner_id].includes(actor),
      "Only session participants can do this",
      403,
    );
    const teacher = s.teacher_id === actor;
    if (action === "accept") {
      requireThat(teacher, "Only the teacher can accept", 403);
      if (s.status === "CONFIRMED") return { ok: true };
      requireThat(
        s.status === "PENDING",
        "This request is no longer pending",
        409,
      );
      const [slot] = await rows(
        "SELECT a.*,o.active AS offer_active FROM availability_slots a JOIN offers o ON o.id=a.offer_id WHERE a.id=? FOR UPDATE",
        [s.slot_id],
        c,
      );
      requireThat(
        slot.offer_active && slot.status === "AVAILABLE" && fromDb(slot.start_at) > new Date(),
        "Slot unavailable",
        409,
      );
      const active = await rows(
        "SELECT active FROM users WHERE id IN (?,?)",
        [s.teacher_id, s.learner_id],
        c,
      );
      requireThat(
        active.every((u) => u.active),
        "Participant unavailable",
        409,
      );
      requireThat(
        !(await overlap(
          c,
          [s.teacher_id, s.learner_id],
          s.start_at,
          s.end_at,
          s.id,
        )),
        "A participant already has a session at this time",
        409,
      );
      const [w] = await rows(
        "SELECT * FROM wallets WHERE user_id=? FOR UPDATE",
        [s.learner_id],
        c,
      );
      requireThat(
        w.balance - w.held_balance >= 1,
        "Learner has insufficient available credits",
        409,
      );
      requireThat(
        typeof data.location === "string" &&
          data.location.trim().length >= 3 &&
          data.location.length <= 1000,
        "Add a meeting link or campus location",
      );
      await rows(
        "INSERT INTO credit_holds(session_id,learner_id) VALUES(?,?)",
        [id, s.learner_id],
        c,
      );
      await rows(
        "UPDATE wallets SET held_balance=held_balance+1 WHERE user_id=?",
        [s.learner_id],
        c,
      );
      await rows(
        "UPDATE sessions SET status='CONFIRMED',location=? WHERE id=?",
        [data.location.trim(), id],
        c,
      );
      await rows(
        "UPDATE sessions SET status='REJECTED' WHERE slot_id=? AND id<>? AND status='PENDING'",
        [s.slot_id, id],
        c,
      );
      await rows(
        "UPDATE availability_slots SET status='BOOKED' WHERE id=?",
        [s.slot_id],
        c,
      );
      await audit(c, actor, "accepted", id);
    } else if (action === "reject") {
      requireThat(
        teacher && s.status === "PENDING",
        "Only a pending request can be rejected",
        409,
      );
      await rows("UPDATE sessions SET status='REJECTED' WHERE id=?", [id], c);
    } else if (action === "cancel") {
      if (s.status === "CANCELLED") return { ok: true };
      if (s.status === "PENDING") {
        await rows(
          "UPDATE sessions SET status='CANCELLED' WHERE id=?",
          [id],
          c,
        );
      } else {
        requireThat(
          s.status === "CONFIRMED" && fromDb(s.start_at) > new Date(),
          "After the start, open a dispute instead",
          409,
        );
        await release(c, s, actor);
      }
    } else if (action === "confirm") {
      if (s.status === "COMPLETED") return { ok: true };
      requireThat(
        s.status === "CONFIRMED" && fromDb(s.end_at) <= new Date(),
        "Confirm attendance after the session ends",
        409,
      );
      await rows(
        "INSERT IGNORE INTO completion_confirmations(session_id,user_id) VALUES(?,?)",
        [id, actor],
        c,
      );
      const [n] = await rows(
        "SELECT COUNT(*) AS n FROM completion_confirmations WHERE session_id=?",
        [id],
        c,
      );
      if (n.n === 2) await settle(c, s, actor);
    } else if (action === "dispute") {
      requireThat(
        s.status === "CONFIRMED",
        "Only unsettled confirmed sessions can be disputed",
        409,
      );
      requireThat(
        typeof data.reason === "string" &&
          data.reason.trim().length >= 10 &&
          data.reason.length <= 2000,
        "Explain the dispute in 10–2000 characters",
      );
      await rows(
        "INSERT INTO disputes(session_id,opened_by,reason) VALUES(?,?,?)",
        [id, actor, data.reason.trim()],
        c,
      );
      await rows("UPDATE sessions SET status='DISPUTED' WHERE id=?", [id], c);
      await audit(c, actor, "disputed", id);
    } else requireThat(false, "Unknown session action");
    return { ok: true };
  });
}
export async function resolveDispute(actor, id, decision, reason) {
  requireThat(
    ["SETTLE", "CANCEL"].includes(decision) &&
      typeof reason === "string" &&
      reason.trim().length >= 10 &&
      reason.length <= 2000,
    "Choose a decision and give a reason (10–2000 characters)",
  );
  return withSession(id, actor, async (c, s) => {
    const [admin] = await rows(
      "SELECT role,active FROM users WHERE id=?",
      [actor],
      c,
    );
    requireThat(
      admin?.active && admin.role === "admin",
      "Administrator access required",
      403,
    );
    const [d] = await rows(
      "SELECT * FROM disputes WHERE session_id=? FOR UPDATE",
      [id],
      c,
    );
    if (d?.status === "RESOLVED") {
      requireThat(
        d.decision === decision,
        "Dispute already resolved differently",
        409,
      );
      return { ok: true };
    }
    requireThat(d && s.status === "DISPUTED", "Open dispute not found", 409);
    if (decision === "SETTLE") await settle(c, s, actor);
    else await release(c, s, actor);
    await rows(
      "UPDATE disputes SET status='RESOLVED',decision=?,admin_reason=?,resolved_by=?,resolved_at=UTC_TIMESTAMP() WHERE session_id=?",
      [decision, reason.trim(), actor, id],
      c,
    );
    await audit(c, actor, "dispute_resolved", id, {
      decision,
      reason: reason.trim(),
    });
    return { ok: true };
  });
}

export async function resolveStalledSession(actor,id,decision,reason){
  requireThat(['SETTLE','CANCEL'].includes(decision)&&typeof reason==='string'&&reason.trim().length>=10&&reason.length<=2000,'Choose a decision and give a reason (10–2000 characters)');
  return withSession(id,actor,async(c,s)=>{
    const [admin]=await rows('SELECT role,active FROM users WHERE id=?',[actor],c);
    requireThat(admin?.active&&admin.role==='admin','Administrator access required',403);
    requireThat(s.status==='CONFIRMED'&&new Date(String(s.start_at).replace(' ','T')+'Z')<new Date(),'Only past confirmed sessions can be resolved');
    if(decision==='SETTLE') await settle(c,s,actor); else await release(c,s,actor);
    await rows("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES(?,?,'session',?,?)",[actor,'stalled_session_'+decision.toLowerCase(),id,JSON.stringify({reason:reason.trim()})],c);
    return {ok:true};
  });
}
