import express from 'express';
import {z} from 'zod';
import {rows,transaction,requireThat,utc} from './db.js';
import {administrator} from './auth.js';
export const challenges=express.Router();
export async function ensureChallenge(c,uid){
  await rows(`INSERT IGNORE INTO learning_challenges(user_id,title,due_at) SELECT u.id,'Teach one useful idea in a 60–120 second video',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 72 HOUR) FROM users u JOIN wallets w ON w.user_id=u.id WHERE u.id=? AND u.role<>'admin' AND u.onboarded=1 AND w.balance=0 AND ((u.is_demo=1 AND u.email LIKE '%@skillswap.example') OR (EXISTS(SELECT 1 FROM credit_transfers t WHERE t.payer_id=u.id AND t.type='SETTLEMENT') AND NOT EXISTS(SELECT 1 FROM credit_transfers t WHERE t.payee_id=u.id AND t.type='SETTLEMENT')))`,[uid],c);
}
export async function refreshChallenge(uid){
 return transaction(async c=>{
  await rows('SELECT id FROM users WHERE id=? FOR UPDATE',[uid],c);
  await ensureChallenge(c,uid);
  await rows("UPDATE learning_challenges SET status='OVERDUE' WHERE user_id=? AND status='OPEN' AND due_at<=UTC_TIMESTAMP()",[uid],c);
  return (await rows('SELECT * FROM learning_challenges WHERE user_id=?',[uid],c))[0]||null;
 });
}
export async function challengeGate(req,res,next){
 const challenge=await refreshChallenge(req.session.user_id);
 req.learningChallenge=challenge;
 const allowed=req.session.role==='admin'||/^\/sessions\/\d+\/(confirm|cancel|dispute)$/.test(req.path)||req.path==='/sessions'||req.path.startsWith('/challenges')||req.path.startsWith('/admin/')||req.path==='/me'||req.path.startsWith('/me/')||req.path==='/dashboard';
 requireThat(!challenge||challenge.status!=='OVERDUE'||allowed,'SkillSwap access is suspended: your challenge deadline passed. Open Challenges to submit a video or ask an admin for an extension.',423);
 next();
}
challenges.get('/challenges',async(req,res)=>res.json({challenge:req.learningChallenge,server_time:new Date().toISOString(),policy:'When all three starter credits are spent learning and no teaching session is completed, submit a safe teaching video within 72 hours. A timely submission pauses suspension during admin review. Zero credits still block booking.'}));
challenges.post('/challenges/:id/submit',async(req,res)=>{
 const id=z.coerce.number().int().positive().parse(req.params.id);
 const d=z.object({mime:z.enum(['video/mp4','video/webm']),data:z.string().min(16).max(16777216)}).parse(req.body);
 requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(d.data),'Invalid video encoding');
 const bytes=Buffer.from(d.data,'base64');
 requireThat(bytes.length>=16&&bytes.length<=12*1024*1024,'Use an MP4/WebM video up to 12 MB');
 requireThat(d.mime==='video/mp4'?bytes.subarray(4,8).toString()==='ftyp':bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])),'This file is not a supported video');
 await transaction(async c=>{
  const [ch]=await rows('SELECT *,due_at<=UTC_TIMESTAMP() AS late FROM learning_challenges WHERE id=? FOR UPDATE',[id],c);
  requireThat(ch?.user_id===req.session.user_id,'Challenge unavailable',404);
  requireThat(['OPEN','OVERDUE'].includes(ch.status),'This challenge has already been submitted or resolved',409);
  await rows('INSERT INTO challenge_videos VALUES(?,?,?) ON DUPLICATE KEY UPDATE mime=VALUES(mime),content=VALUES(content)',[id,d.mime,bytes],c);
  await rows("UPDATE learning_challenges SET status=IF(?,'OVERDUE','SUBMITTED'),submitted_at=UTC_TIMESTAMP() WHERE id=?",[!!ch.late,id],c);
  await rows("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES(?,'challenge.submitted','challenge',?,?)",[req.session.user_id,id,JSON.stringify({late:!!ch.late})],c);
 });res.json({ok:true});
});
challenges.get('/challenges/:id/video',async(req,res)=>{
 const [v]=await rows('SELECT v.*,ch.user_id FROM challenge_videos v JOIN learning_challenges ch ON ch.id=v.challenge_id WHERE ch.id=?',[req.params.id]);
 requireThat(v&&(v.user_id===req.session.user_id||req.session.role==='admin'),'Video unavailable',404);
 const size=v.content.length;const range=req.headers.range;
 res.set({'Content-Type':v.mime,'Accept-Ranges':'bytes','Content-Disposition':'inline','Cache-Control':'private, no-store'});
 if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m)return res.status(416).set('Content-Range',`bytes */${size}`).end();const start=Number(m[1]),end=m[2]?Math.min(size-1,Number(m[2])):size-1;if(start>=size||end<start)return res.status(416).set('Content-Range',`bytes */${size}`).end();res.status(206).set('Content-Range',`bytes ${start}-${end}/${size}`).send(v.content.subarray(start,end+1));}else res.send(v.content);
});
challenges.get('/admin/challenges',administrator,async(req,res)=>res.json(await rows('SELECT c.*,u.display_name,u.email FROM learning_challenges c JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT 200')));
challenges.post('/admin/challenges/:id/review',administrator,async(req,res)=>{
 const d=z.object({decision:z.enum(['APPROVE','EXTEND','WAIVE']),note:z.string().trim().min(5).max(1000)}).parse(req.body);
 await transaction(async c=>{
  const [ch]=await rows('SELECT * FROM learning_challenges WHERE id=? FOR UPDATE',[req.params.id],c);requireThat(ch,'Challenge not found',404);
  if(d.decision==='APPROVE')requireThat(ch.submitted_at,'Review a submitted video first');
  const status={APPROVE:'APPROVED',EXTEND:'OPEN',WAIVE:'WAIVED'}[d.decision];
  await rows('UPDATE learning_challenges SET status=?,due_at=?,reviewed_by=?,review_note=? WHERE id=?',[status,d.decision==='EXTEND'?utc(Date.now()+72*3600000):ch.due_at,req.session.user_id,d.note,ch.id],c);
  if(d.decision==='EXTEND'){await rows('DELETE FROM challenge_videos WHERE challenge_id=?',[ch.id],c);await rows('UPDATE learning_challenges SET submitted_at=NULL WHERE id=?',[ch.id],c);}
  await rows("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES(?,'challenge.reviewed','challenge',?,?)",[req.session.user_id,ch.id,JSON.stringify(d)],c);
 });res.json({ok:true});
});
