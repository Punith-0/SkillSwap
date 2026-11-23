import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyHubIdentity} from '../server/hub-identity.js';
import {pool} from '../server/db.js';
const original=process.env.HUB_BRIDGE_SECRET;
process.env.HUB_BRIDGE_SECRET='test-bridge-secret-'.repeat(3);
after(async()=>{if(original===undefined)delete process.env.HUB_BRIDGE_SECRET;else process.env.HUB_BRIDGE_SECRET=original;await pool.end()});
function signed(at=Date.now()/1000){
 const encoded=Buffer.from(JSON.stringify({at,email:'owner@example.test',sid:'test-session',csrf:'c'.repeat(32)})).toString('base64url');
 const req={method:'POST',originalUrl:'/api/profile',rawBody:Buffer.from('{"name":"test"}'),headers:{'x-punithhub-identity':encoded}};
 const digest=crypto.createHash('sha256').update(req.rawBody).digest('hex');
 req.headers['x-punithhub-signature']=crypto.createHmac('sha256',process.env.HUB_BRIDGE_SECRET).update([req.method,req.originalUrl,digest,encoded].join('\n')).digest('hex');return req;
}
test('unsigned requests have no hub identity',()=>assert.equal(verifyHubIdentity({headers:{}}),null));
test('valid signed request verifies without database access',()=>assert.equal(verifyHubIdentity(signed()).email,'owner@example.test'));
test('modified body, route, signature and expired identity are rejected',()=>{
 for(const mutate of [r=>r.rawBody=Buffer.from('{}'),r=>r.originalUrl='/api/admin/reports',r=>r.headers['x-punithhub-signature']='0'.repeat(64)]){const r=signed();mutate(r);assert.throws(()=>verifyHubIdentity(r));}
 assert.throws(()=>verifyHubIdentity(signed(Date.now()/1000-60)));
});
