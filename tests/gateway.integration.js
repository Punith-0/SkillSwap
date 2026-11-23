import assert from "node:assert/strict";
const base = "http://127.0.0.1:8787";
let cookie = "",
  csrf = "";
async function call(path, body, method=body?'POST':'GET') {
  const r = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const next = r.headers.get("set-cookie");
  if (next) cookie = next.split(";")[0];
  let data;
  const text = await r.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: r.status, data, location: r.headers.get("location") };
}
const initial = await call("/api/session");
assert.equal(initial.status, 200);
assert.equal(initial.data.demo, true, "Only run against the local demo hub");
csrf = initial.data.csrf;
assert.equal(
  (await call("/projects/skillswap/app/api/session")).status,
  403,
  "Anonymous gateway denied",
);
assert.equal(
  (
    await call("/api/auth/request", {
      email: "blocked-" + Date.now() + "@example.test",
    })
  ).status,
  400,
  "Main login requires CAPTCHA",
);
const email = "gateway-" + Date.now() + "@example.test";
let result = await call("/api/auth/request", {
  email,
  captcha_token: "local-preview",
});
assert.equal(result.status, 200);
assert.equal(
  (
    await call("/api/auth/verify", {
      challenge_id: result.data.challenge_id,
      code: result.data.preview_code,
    })
  ).status,
  200,
);
csrf = (await call("/api/session")).data.csrf;
assert.equal(
  (await call("/projects/skillswap/app/api/session")).status,
  403,
  "Login alone is not a project grant",
);
result = await call("/api/projects/skillswap/request", {
  captcha_token: "local-preview",
});
assert.equal(result.status, 200, JSON.stringify(result));
assert.equal(
  (
    await call("/api/projects/skillswap/verify", {
      challenge_id: result.data.challenge_id,
      code: result.data.preview_code,
    })
  ).status,
  200,
);
const page = await call("/projects/skillswap");
assert.equal(page.location, "/projects/skillswap/app/");
result = await call("/projects/skillswap/app/");
assert.equal(result.status, 200);
assert.match(
  result.data,
  /\.\/assets\//,
  "Built frontend supports same-origin mount",
);
result = await call("/projects/skillswap/app/api/session");
assert.equal(result.status, 200, JSON.stringify(result));
assert.equal(result.data.user.email, email);
assert.equal(result.data.hub, true);
assert.equal(result.data.csrf, csrf);
result = await call("/projects/skillswap/app/api/dashboard");
assert.equal(result.status, 200, JSON.stringify(result));
assert.equal(result.data.wallet.available, 3);
assert.equal((await call('/projects/skillswap/app/api/offers')).status,428);
assert.equal((await call('/projects/skillswap/app/api/me',{display_name:'Gateway test',age:22,college:'API Campus',department:'Computing',study_year:'Year 3',bio:'',interests:'SQL',learning_goals:'React',preferred_mode:'Online'},'PATCH')).status,200);
const offers = await call("/projects/skillswap/app/api/offers");
assert.equal(offers.status, 200);
assert.ok(offers.data.length >= 6);
assert.ok(
  !("location" in offers.data[0]),
  "Discovery excludes private meeting details",
);
assert.equal(
  (await call("/projects/skillswap/app/api/admin/reports")).status,
  403,
);
const saved = csrf;
csrf = "invalid";
assert.equal(
  (await call("/projects/skillswap/app/api/offers", { name: "Should fail" }))
    .status,
  403,
);
csrf = saved;
assert.equal((await call("/api/projects/skillswap/close", {})).status, 200);
assert.equal(
  (await call("/projects/skillswap/app/api/dashboard")).status,
  403,
  "Revocation applies immediately",
);
const forged = await fetch("http://127.0.0.1:8790/api/session", {
  headers: {
    "X-PunithHub-Identity": "fake",
    "X-PunithHub-Signature": "0".repeat(64),
  },
});
assert.equal(forged.status, 403);
console.log(
  "PASS: login CAPTCHA, project OTP, same-origin frontend, signed identity, MySQL starter grant, private-data filtering, admin denial, CSRF, revocation, and forged-header rejection.",
);
