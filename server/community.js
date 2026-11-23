import express from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { rows, transaction, requireThat, lockUsers } from './db.js';
import { administrator } from './auth.js';

export const community = express.Router();
export const profileSchema = z.object({
  display_name:z.string().trim().min(2).max(80), age:z.coerce.number().int().min(13).max(100),
  college:z.string().trim().min(2).max(160), department:z.string().trim().min(2).max(100),
  study_year:z.string().trim().min(1).max(40), bio:z.string().trim().max(1000),
  interests:z.string().trim().min(2).max(500), learning_goals:z.string().trim().min(2).max(500),
  preferred_mode:z.enum(['Online','Campus','Either'])
});
export async function saveProfile(uid, body) {
  const d=profileSchema.parse(body);
  await rows('UPDATE users SET display_name=?,age=?,college=?,department=?,study_year=?,bio=?,interests=?,learning_goals=?,preferred_mode=?,onboarded=1 WHERE id=?', [...Object.values(d),uid]);
  return {ok:true};
}
export async function requireProfile(req,res,next){
  if(req.path.startsWith('/me')||req.path.startsWith('/admin')||req.path==='/dashboard')return next();
  const [u]=await rows('SELECT onboarded FROM users WHERE id=?',[req.session.user_id]);
  requireThat(u?.onboarded,'Complete your first-visit profile before using SkillSwap',428);
  next();
}
export async function mediaList(uid){return rows('SELECT id,title,mime,kind,created_at FROM profile_media WHERE user_id=? ORDER BY created_at DESC',[uid]);}
community.get('/people/:id', async(req,res)=>{
 const [u]=await rows('SELECT id,display_name,college,department,study_year,bio,interests,learning_goals,is_demo FROM users WHERE id=? AND active=1',[z.coerce.number().int().positive().parse(req.params.id)]);
 requireThat(u,'Profile not found',404);
 res.json({...u,media:await mediaList(u.id)});
});
community.get('/me/media',async(req,res)=>res.json(await mediaList(req.session.user_id)));
community.post('/me/media',async(req,res)=>{
 const d=z.object({kind:z.enum(['avatar','document']),title:z.string().trim().min(1).max(120),mime:z.enum(['image/png','image/jpeg','application/pdf']),data:z.string().min(1).max(2800000)}).parse(req.body);
 requireThat(/^[A-Za-z0-9+/]+={0,2}$/.test(d.data),'Invalid file encoding');
 const content=Buffer.from(d.data,'base64');
 requireThat(content.length<=2*1024*1024,'Maximum file size is 2 MB');
 const valid=d.mime==='image/png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):d.mime==='image/jpeg'?content[0]===255&&content[1]===216&&content[2]===255:content.subarray(0,5).toString()==='%PDF-';
 requireThat(valid && (d.kind!=='avatar'||d.mime.startsWith('image/')),'Use a real PNG/JPEG photo or PDF document');
 const id=crypto.randomBytes(24).toString('hex');
 await transaction(async c=>{
   await lockUsers(c,[req.session.user_id]);
   const [n]=await rows('SELECT COUNT(*) AS n FROM profile_media WHERE user_id=?',[req.session.user_id],c);
   requireThat(d.kind==='avatar'||n.n<11,'You can share up to ten documents');
   if(d.kind==='avatar')await rows("DELETE FROM profile_media WHERE user_id=? AND kind='avatar'",[req.session.user_id],c);
   await rows('INSERT INTO profile_media(id,user_id,kind,title,mime,content) VALUES(?,?,?,?,?,?)',[id,req.session.user_id,d.kind,d.title,d.mime,content],c);
 });
 res.status(201).json({id});
});
community.delete('/me/media/:id',async(req,res)=>{
 const result=await rows('DELETE FROM profile_media WHERE id=? AND user_id=?',[req.params.id,req.session.user_id]);
 requireThat(result.affectedRows,'File not found',404);res.json({ok:true});
});
community.get('/media/:id',async(req,res)=>{
 const [f]=await rows('SELECT m.* FROM profile_media m JOIN users u ON u.id=m.user_id WHERE m.id=? AND u.active=1',[req.params.id]);
 requireThat(f,'File not found',404);
 res.set({'Content-Type':f.mime,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Content-Disposition':`${f.kind==='avatar'?'inline':'attachment'}; filename="${f.id}.${f.mime==='application/pdf'?'pdf':f.mime==='image/png'?'png':'jpg'}"`}).send(f.content);
});
community.get('/recommendations',async(req,res)=>{
 const [u]=await rows('SELECT * FROM users WHERE id=?',[req.session.user_id]);
 const offers=await rows(`SELECT o.*,sk.name,sk.category,u.display_name,u.department,u.college,u.is_demo,MIN(a.start_at) AS next_slot,(SELECT id FROM profile_media WHERE user_id=u.id AND kind='avatar' LIMIT 1) AS avatar FROM offers o JOIN skills sk ON sk.id=o.skill_id JOIN users u ON u.id=o.teacher_id JOIN availability_slots a ON a.offer_id=o.id AND a.status='AVAILABLE' AND a.start_at>UTC_TIMESTAMP() WHERE o.active=1 AND u.active=1 AND o.teacher_id<>? GROUP BY o.id,sk.name,sk.category,u.id ORDER BY next_slot LIMIT 300`,[u.id]);
 const terms=(u.interests+' '+u.learning_goals).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>2);
 res.json(offers.map(o=>{const text=(o.name+' '+o.category+' '+o.description).toLowerCase();const matches=[...new Set(terms.filter(t=>text.includes(t)))];const reasons=[];let score=matches.length*5;if(matches.length)reasons.push('Matches '+matches.slice(0,3).join(', '));if(o.department.toLowerCase()===u.department.toLowerCase()){score+=3;reasons.push('Your stream');}if(o.college===u.college){score+=2;reasons.push('Your college');}if(o.mode===u.preferred_mode){score+=2;reasons.push('Preferred '+o.mode.toLowerCase()+' format');}return {...o,score,reasons:reasons.length?reasons:['Explore something new']};}).sort((a,b)=>b.score-a.score).slice(0,6));
});
const bulkSchema=z.array(z.object({user_id:z.coerce.number().int().positive(),name:z.string().trim().min(2).max(100),category:z.enum(['Technology','Design','Languages','Academics','Music','Life skills']),level:z.enum(['Beginner','Intermediate','Advanced']),mode:z.enum(['Online','Campus']),description:z.string().trim().min(15).max(2000)})).min(1).max(100);
community.post('/admin/skills/bulk',administrator,async(req,res)=>{
 const items=bulkSchema.parse(req.body.items);
 await transaction(async c=>{await lockUsers(c,items.map(i=>i.user_id));for(const d of items){
 await rows('INSERT IGNORE INTO skills(name,category) VALUES(?,?)',[d.name,d.category],c);
 const [s]=await rows('SELECT id FROM skills WHERE name=?',[d.name],c);
 await rows('INSERT INTO offers(teacher_id,skill_id,level,mode,description) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE level=VALUES(level),mode=VALUES(mode),description=VALUES(description)',[d.user_id,s.id,d.level,d.mode,d.description],c);
 }await rows("INSERT INTO audit_events(actor_id,action,entity_type,details) VALUES(?,'skills.bulk','offer',?)",[req.session.user_id,JSON.stringify({count:items.length,user_ids:[...new Set(items.map(i=>i.user_id))]})],c);});
 res.json({ok:true,count:items.length});
});

const demoImportSchema=z.array(z.object({
 display_name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254),
 scenario:z.enum(['standard','zero_credits_task']).default('standard'),
 college:z.string().trim().min(2).max(160),department:z.string().trim().min(2).max(100),
 study_year:z.string().trim().min(1).max(40),age:z.coerce.number().int().min(13).max(100),
 interests:z.string().trim().min(2).max(500),learning_goals:z.string().trim().min(2).max(500),
 preferred_mode:z.enum(['Online','Campus','Either']),skill:z.string().trim().min(2).max(100),
 category:z.enum(['Technology','Design','Languages','Academics','Music','Life skills']),
 level:z.enum(['Beginner','Intermediate','Advanced']),mode:z.enum(['Online','Campus']),
 description:z.string().trim().min(15).max(2000),slot_at:z.string().datetime({offset:true})
})).min(1).max(100);
community.post('/admin/demo-import',administrator,async(req,res)=>{
 const items=demoImportSchema.parse(req.body.items);
 const seen=new Set();
 for(const d of items){
  const email=d.email.toLowerCase();
  requireThat(!seen.has(email),'Each demo email must be unique in the CSV');seen.add(email);
  requireThat(new Date(d.slot_at)>new Date(),'Demo availability must be in the future');
 }
 const created=await transaction(async c=>{
  const result=[];
  for(const d of items){
   const email=d.email.toLowerCase();
   const [existing]=await rows('SELECT id,is_demo FROM users WHERE email=? FOR UPDATE',[email],c);
   requireThat(!existing||existing.is_demo,'Email '+email+' already belongs to a non-demo account');
   let uid=existing?.id;
   if(uid){
    await rows('UPDATE users SET display_name=?,department=?,age=?,college=?,study_year=?,interests=?,learning_goals=?,preferred_mode=?,onboarded=1,active=1 WHERE id=?',[d.display_name,d.department,d.age,d.college,d.study_year,d.interests,d.learning_goals,d.preferred_mode,uid],c);
   }else{
    const account=await rows("INSERT INTO users(email,display_name,department,role,age,college,study_year,interests,learning_goals,preferred_mode,onboarded,is_demo) VALUES(?,?,?,'student',?,?,?,?,?,?,1,1)",[email,d.display_name,d.department,d.age,d.college,d.study_year,d.interests,d.learning_goals,d.preferred_mode],c);
    uid=account.insertId;
    await rows('INSERT INTO wallets(user_id,balance,held_balance) VALUES(?,?,0)',[uid,d.scenario==='zero_credits_task'?0:3],c);
    if(d.scenario!=='zero_credits_task')await rows("INSERT INTO credit_transfers(payee_id,amount,type,idempotency_key) VALUES(?,3,'GRANT',?)",[uid,`starter:${uid}`],c);
   }
   if(d.scenario==='zero_credits_task'){
    // This is an explicit local QA scenario, so represent the task directly
    // without fabricating a session or credit transfer.
    await rows('INSERT INTO learning_challenges(user_id,title,due_at,status) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 72 HOUR),\'OPEN\') ON DUPLICATE KEY UPDATE title=VALUES(title),due_at=VALUES(due_at),status=\'OPEN\'', [uid,'QA task: share one useful idea in a 60–120 second teaching video'],c);
   }
   await rows('INSERT IGNORE INTO skills(name,category) VALUES(?,?)',[d.skill,d.category],c);
   const [sk]=await rows('SELECT id FROM skills WHERE name=?',[d.skill],c);
   await rows('INSERT INTO offers(teacher_id,skill_id,level,mode,description) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE level=VALUES(level),mode=VALUES(mode),description=VALUES(description),active=1',[uid,sk.id,d.level,d.mode,d.description],c);
   const [offer]=await rows('SELECT id FROM offers WHERE teacher_id=? AND skill_id=?',[uid,sk.id],c);
   const start=new Date(d.slot_at).toISOString().slice(0,19).replace('T',' ');
   const end=new Date(new Date(d.slot_at).getTime()+3600000).toISOString().slice(0,19).replace('T',' ');
   await rows("INSERT INTO availability_slots(offer_id,start_at,end_at,status) SELECT ?,?,?,'AVAILABLE' WHERE NOT EXISTS(SELECT 1 FROM availability_slots WHERE offer_id=? AND start_at=? AND status='AVAILABLE')",[offer.id,start,end,offer.id,start],c);
   result.push({email,id:uid});
  }
  await rows("INSERT INTO audit_events(actor_id,action,entity_type,details) VALUES(?,'demo.bulk_import','user',?)",[req.session.user_id,JSON.stringify({count:result.length,emails:result.map(x=>x.email)})],c);
  return result;
 });
 res.status(201).json({ok:true,count:created.length,users:created});
});
