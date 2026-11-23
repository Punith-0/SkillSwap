import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeftRight,
  Search,
  Compass,
  CalendarDays,
  BookOpen,
  Wallet,
  Settings,
  ShieldCheck,
  Github,
  Plus,
  X,
  Star,
  Clock,
  Monitor,
  MapPin,
  Check,
  LogOut,
  Sparkles,
  GraduationCap,
  Code2,
  Palette,
  Music,
  Languages,
  ChevronRight,
  Menu,
} from "lucide-react";
import "./style.css";
import "./admin-portal.css";
import {AdminPortal} from "./admin-portal.jsx";
import {InstallApp} from './install-app.jsx';
import "./shared/action-motion.css";
import "./shared/project-play.css";
import "./shared/project-play.js";
import './shared/orbit-otp.js';
import './shared/orbit-otp.css';
import {Skeleton} from './skeleton.jsx';
import {ChallengePanel} from './challenges.jsx';
import { ProfilePanel, Recommendations, BulkSkills } from './community.jsx';
const mount = location.pathname.startsWith("/projects/skillswap/app")
  ? "/projects/skillswap/app"
  : "";
let csrf = "";
async function api(path, options = {}) {
  const response = await fetch(mount + "/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {const error=new Error(data.error || "Request failed");error.status=response.status;throw error;}
  return data;
}
const when = (value) =>
  new Date(String(value).replace(" ", "T") + "Z").toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const icons = {
  Technology: Code2,
  Design: Palette,
  Languages,
  Academics: GraduationCap,
  Music,
  "Life skills": Sparkles,
};
function Button({ children, secondary = false, ...props }) {
  return (
    <button className={secondary ? "button secondary" : "button"} {...props}>
      {children}
    </button>
  );
}
function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <header>
        <div>
          <span className="eyebrow">SKILLSWAP</span>
          <h2>{title}</h2>
        </div>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Empty({
  title = "A little quiet here",
  text = "Your next learning adventure starts with one conversation.",
  action,
}) {
  return (
    <div className="empty">
      <BookOpen size={34} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function App() {
  const [profile,setProfile]=useState(null);
  const [showTools,setShowTools]=useState(false);
  const [member,setMember]=useState(null);
  const [session, setSession] = useState(null),
    [view, setView] = useState(
      location.pathname === "/admin" ? "admin" : ["discover","sessions","teach","credits","profile","admin","challenges"].includes(new URLSearchParams(location.search).get("view")) ? new URLSearchParams(location.search).get("view") : "discover",
    ),
    [theme, setTheme] = useState(
      localStorage.getItem("skillswap-theme") || "arcade",
    ),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(null),
    [data, setData] = useState([]),
    [stats, setStats] = useState(null),
    [loading, setLoading] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [mode, setMode] = useState(""),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [mobile, setMobile] = useState(false);
  const refresh = () => setRevision((x) => x + 1);
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 5000);
  };
  const run = async (fn, message) => {
    try {
      await fn();
      setModal(null);
      refresh();
      if (message) notify(message);
    } catch (e) {
      setError(e.message);
      return e.message;
    }
  };
  const boot = async () => {
    try {
      const s = await api("/session");
      csrf = s.csrf;
      if(s.user){const p=await api('/me');setProfile(p);if(!p.onboarded)setView('profile');}
      setSession(s);
    } catch (e) {
      setError(e.message);
      return e.message;
    }
  };
  useEffect(() => {
    boot();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("skillswap-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!session?.user) return;
    if(view === "admin" && session.user.role !== "admin"){setData([]);setLoading(false);setError("This portal is restricted to SkillSwap administrators.");return;}
    let live = true;
    setLoading(true);
    setError("");
    const routes = {
      discover:
        "/offers?" + new URLSearchParams({ q: query, category, mode, page }),
      sessions: "/sessions",
      teach: "/offers/mine",
      credits: "/wallet",
      profile: "/me",
      challenges: "/challenges",
      admin: "/admin/reports",
    };
    Promise.all([api(routes[view] || routes.discover), api("/dashboard")])
      .then(([d, s]) => {
        if (live) {
          setData(d);
          setStats(s);
          if(s.challenge?.status==='OVERDUE'&&!['challenges','profile','admin','sessions'].includes(view))setView('challenges');
        }
      })
      .catch((e) => {
        if (live) {setError(e.message);if(e.status===423)setView("challenges");}
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session, view, query, category, mode, page, revision]);
  const nav = (v) => {
    if(profile&&!profile.onboarded&&v!=='profile'){setError('Complete your first-visit profile to unlock SkillSwap.');return;}
    history.replaceState(null, "", v === "admin" ? "/admin" : "/?view=" + encodeURIComponent(v));
    setView(v);
    setData([]);
    setMobile(false);
    setError("");
  };
  const links = [
    ["discover", Compass, "Discover"],
    ["sessions", CalendarDays, "My sessions"],
    ["teach", BookOpen, "Teach a skill"],
    ["credits", Wallet, "My credits"],
    ["challenges", ShieldCheck, "Challenges · 72h"],
    ["profile", Settings, "My profile"],
  ];
  if (session?.user?.role === "admin")
    links.push(
      ["admin", ShieldCheck, "Admin portal"],
    );
  const user = session?.user;
  return (
    <div className={mount ? "shell project-focus"+(showTools?" show-project-tools":"") : "shell"}>
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a className="brand" href={mount + "/"}>
          <div className="brand-mark">
            <ArrowLeftRight />
          </div>
          <div>
            SkillSwap<span>BY PUNITHHUB</span>
          </div>
        </a>
        <div className="space-label">YOUR LEARNING SPACE</div>
        <nav>
          {links.map(([v, I, label]) => (
            <button
              key={v}
              className={view === v ? "selected" : ""}
              onClick={() => nav(v)}
            >
              <I size={19} />
              {label}
              {v === "sessions" && Number(stats?.stats?.requests) > 0 && (
                <b>{stats.stats.requests}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="credit-mini">
            <Sparkles />
            <strong>Knowledge goes both ways.</strong>
            <p>
              Share what you know.
              <br />
              Learn what you love.
            </p>
            <button onClick={() => nav("teach")}>
              Start teaching <ArrowUpRight size={15} />
            </button>
          </div>
<a
            className="owner"
            href="https://github.com/Punith-0"
            target="_blank"
            rel="noreferrer"
          >
            Crafted by Punith Dewangan
          </a>
        </div>
      </aside>
      <div className="main">
        {mount&&<div className="project-focus-bar"><a href="/hub">← Back to Hub</a><div className="focus-project-label"><span>BY PUNITH DEWANGAN</span><strong>SkillSwap <small>· {links.find(x=>x[0]===view)?.[2] || "Discover"}</small></strong></div><div><button className="mobile-toggle" onClick={()=>setMobile(!mobile)} aria-label="Project navigation"><Menu size={18}/></button><button onClick={()=>setShowTools(!showTools)} aria-expanded={showTools}>Workspace tools</button></div></div>}
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {links.find((x) => x[0] === view)?.[2] || "Discover"}
            </strong>
          </div>
          <div className="top-actions">
            <InstallApp/>
            <select
              aria-label="Theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="arcade">Arcade</option>
              <option value="light">Daylight</option>
              <option value="nebula">Nebula</option><option value="midnight">Midnight blue</option><option value="ember">Ember</option><option value="paper">Warm paper</option>
            </select>
            <span className="campus">
              <span /> CAMPUS EDITION
            </span>
            {user ? (
              <button className="profile-chip" onClick={() => nav("profile")}>
                <span>{user.display_name?.slice(0, 1)}</span>
                {user.display_name?.split(" ")[0]}
              </button>
            ) : (
              <Button onClick={() => setModal({ type: "login" })}>
                Join the exchange <ArrowUpRight size={16} />
              </Button>
            )}
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                A LITTLE CURIOSITY. A LOT OF POSSIBILITY.
              </span>
              <h1>
                {view === "discover" ? (
                  <>
                    Your next skill
                    <br className="desktop-break" /> starts with a{" "}
                    <em>swap.</em>
                  </>
                ) : (
                  {
                    sessions: "Make time for growth.",
                    teach: "Your knowledge has value.",
                    credits: "Small credits. Big possibilities.",
                    profile: "Make yourself known.",
                    admin: "Keep the community thriving.",
                    github: "Your projects, connected.",
                  }[view]
                )}
              </h1>
              <p>
                {view === "discover"
                  ? "Find your people. Share your strengths. Learn something that sticks."
                  : view === "github"
                    ? "Connect GitHub, select a repository, and validate its hub integration."
                    : "A space to learn together, one meaningful exchange at a time."}
              </p>
            </div>
            {view === "discover" && (
              <div className="hero-art" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="float-card code-card">
                  <Code2 />
                  <span>YOU TEACH</span>
                  <strong>Something you know.</strong>
                </div>
                <div className="swap-center">
                  <ArrowLeftRight size={34} />
                </div>
                <div className="float-card design-card">
                  <Palette />
                  <span>YOU LEARN</span>
                  <strong>Something new.</strong>
                </div>
                <span className="tiny-star">✦</span>
              </div>
            )}
          </div>
          {session?.demo && (
            <div className="demo-label">
              <span /> LOCAL DEMO · OTP is shown on screen. No emails are sent.
              All bookings use your local MySQL database.
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {session?.user && !stats && loading && <Skeleton kind="stats" count={3}/>}
          {stats && (
            <section className="stats">
              <article>
                <div className="stat-icon mint">
                  <Wallet />
                </div>
                <div>
                  <span>Available credits</span>
                  <strong>
                    {stats.wallet.available}
                    <small>to keep learning</small>
                  </strong>
                </div>
              </article>
              <article>
                <div className="stat-icon purple">
                  <GraduationCap />
                </div>
                <div>
                  <span>Sessions completed</span>
                  <strong>
                    {stats.stats.completed || 0}
                    <small>new perspectives</small>
                  </strong>
                </div>
              </article>
              <article>
                <div className="stat-icon peach">
                  <CalendarDays />
                </div>
                <div>
                  <span>Upcoming sessions</span>
                  <strong>
                    {stats.stats.upcoming || 0}
                    <small>something to look forward to</small>
                  </strong>
                </div>
              </article>
            </section>
          )}
          {!session && !error ? <Skeleton count={3}/> : !user ? (
            <section className="welcome-panel">
              <div>
                <div className="pill">LEARN BY TEACHING</div>
                <h2>
                  Everyone knows something
                  <br />
                  worth sharing.
                </h2>
                <p>
                  Create a profile, add your skills and start with three
                  learning credits. One hour of teaching earns one credit for
                  your next lesson.
                </p>
                <Button
                  onClick={() => setModal({ type: "login", register: true })}
                >
                  Create your profile <ArrowRight size={17} />
                </Button>
                <button
                  className="text-button"
                  onClick={() => setModal({ type: "login" })}
                >
                  Already a member? Sign in
                </button>
              </div>
              <div className="steps">
                {[
                  [
                    "01",
                    "Find your next thing",
                    "Explore skills from people around you.",
                  ],
                  [
                    "02",
                    "Make a little time",
                    "Book a focused 60-minute session.",
                  ],
                  ["03", "Keep it going", "Teach, earn a credit, learn again."],
                ].map(([n, t, p]) => (
                  <article key={n}>
                    <span>{n}</span>
                    <div>
                      <h3>{t}</h3>
                      <p>{p}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : loading ? (
            <Skeleton kind={view} count={view==='profile'?2:3}/>
          ) : (
            <>
              {view === "discover" && (
                <>
                  <Recommendations api={api} mount={mount} onBook={async o=>{try{const slots=await api('/offers/'+o.id+'/slots');setModal({type:'book',offer:o,slots});}catch(e){setError(e.message)}}}/>
                  <div className="section-title">
                    <div>
                      <h2>What will you learn next?</h2>
                      <p>Small sessions. Real connections. One credit each.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => nav("teach")}
                    >
                      Share a skill <Plus size={17} />
                    </button>
                  </div>
                  <div className="filters">
                    <label className="search">
                      <Search size={18} />
                      <input
                        aria-label="Search skills or people"
                        placeholder="Try ‘guitar’, ‘React’ or a teacher’s name"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setPage(0);
                        }}
                      />
                    </label>
                    <select
                      aria-label="Mode"
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="">Any format</option>
                      <option>Online</option>
                      <option>Campus</option>
                    </select>
                  </div>
                  <div className="categories">
                    {[
                      "",
                      "Technology",
                      "Design",
                      "Languages",
                      "Academics",
                      "Music",
                      "Life skills",
                    ].map((c) => (
                      <button
                        key={c}
                        className={category === c ? "active" : ""}
                        onClick={() => {
                          setCategory(c);
                          setPage(0);
                        }}
                      >
                        {c || "Explore all"}
                      </button>
                    ))}
                  </div>
                  <div className="cards">
                    {Array.isArray(data) &&
                      data.map((o, i) => {
                        const I = icons[o.category] || BookOpen;
                        return (
                          <article
                            className={"skill-card tone-" + (i % 4)}
                            key={o.id}
                          >
                            <div className="skill-top">
                              <div className="skill-symbol">
                                <I size={26} />
                              </div>
                              <span className="tag">{o.category}{o.is_demo?" · Demo":""}</span>
                            </div>
                            <h3>{o.name}</h3>
                            <p className="description">{o.description}</p>
                            <div className="teacher">
                              <span className="avatar">
                                {o.display_name[0]}
                              </span>
                              <div>
                                <button className="text-button" onClick={async()=>{try{setMember(await api('/people/'+o.teacher_id))}catch(e){setError(e.message)}}}>{o.display_name}</button>
                                <span>
                                  {o.department || "Campus community"}
                                </span>
                              </div>
                              <span className="rating">
                                <Star size={13} />
                                {o.rating ? Number(o.rating).toFixed(1) : "New"}
                              </span>
                            </div>
                            <div className="card-details">
                              <span>
                                {o.mode === "Online" ? (
                                  <Monitor size={14} />
                                ) : (
                                  <MapPin size={14} />
                                )}{" "}
                                {o.mode}
                              </span>
                              <span>
                                <Clock size={14} />
                                60 minutes
                              </span>
                              <span>{o.level}</span>
                            </div>
                            <footer>
                              <div>
                                <b>1</b> learning credit
                              </div>
                              <button
                                disabled={o.teacher_id === user.id}
                                onClick={async () => {
                                  try {
                                    setModal({
                                      type: "book",
                                      offer: o,
                                      slots: await api(
                                        "/offers/" + o.id + "/slots",
                                      ),
                                    });
                                  } catch (e) {
                                    setError(e.message);
                                  }
                                }}
                              >
                                {o.teacher_id === user.id
                                  ? "Your offer"
                                  : "View slots"}{" "}
                                <ArrowUpRight size={16} />
                              </button>
                            </footer>
                          </article>
                        );
                      })}
                  </div>
                  {!data.length && (
                    <Empty
                      title="No skills found yet"
                      text="Try another search, or become the first person to share a skill."
                      action={
                        <Button onClick={() => nav("teach")}>
                          Teach something <Plus size={16} />
                        </Button>
                      }
                    />
                  )}
                  <div className="pagination">
                    <Button
                      secondary
                      disabled={!page}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </Button>
                    <span>Page {page + 1}</span>
                    <Button
                      secondary
                      disabled={data.length < 12}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </>
              )}
              {view === "sessions" && (
                <>
                  <div className="section-title">
                    <h2>Your exchanges</h2>
                    <span className="muted">All times shown in IST</span>
                  </div>
                  <div className="session-list">
                    {Array.isArray(data) &&
                      data.map((s) => {
                        const teacher = s.teacher_id === user.id,
                          ended =
                            new Date(s.end_at.replace(" ", "T") + "Z") <
                            new Date(),
                          started =
                            new Date(s.start_at.replace(" ", "T") + "Z") <
                            new Date();
                        return (
                          <article className="session-card" key={s.id}>
                            <div className="session-date">
                              <CalendarDays />
                              <span>{when(s.start_at)}</span>
                            </div>
                            <div className="session-info">
                              <span
                                className={"status " + s.status.toLowerCase()}
                              >
                                {s.status}
                              </span>
                              <h3>{s.name}</h3>
                              <p>
                                {teacher
                                  ? "Teaching " + s.learner_name
                                  : "Learning with " + s.teacher_name}
                              </p>
                              {s.location && (
                                <p className="location">
                                  <MapPin size={14} />
                                  {s.location}
                                </p>
                              )}
                              {s.stalled && (
                                <p className="warning">
                                  Awaiting confirmation for 48+ hours. Contact
                                  an administrator.
                                </p>
                              )}
                              {s.status === "CONFIRMED" && (
                                <small>
                                  {s.confirmations}/2 attendance confirmations
                                </small>
                              )}
                            </div>
                            <div className="session-actions">
                              {s.status === "PENDING" && teacher && (
                                <>
                                  <Button
                                    onClick={() =>
                                      setModal({
                                        type: "action",
                                        title: "Accept session",
                                        field: "location",
                                        label:
                                          "Private meeting link or campus location",
                                        action: () => {},
                                        session: s,
                                        verb: "accept",
                                      })
                                    }
                                  >
                                    Accept
                                  </Button>
                                  <Button
                                    secondary
                                    onClick={() =>
                                      run(
                                        () =>
                                          api(`/sessions/${s.id}/reject`, {
                                            method: "POST",
                                            body: {},
                                          }),
                                        "Request declined",
                                      )
                                    }
                                  >
                                    Decline
                                  </Button>
                                </>
                              )}
                              {["PENDING", "CONFIRMED"].includes(s.status) &&
                                (!started || s.status === "PENDING") && (
                                  <Button
                                    secondary
                                    onClick={() =>
                                      run(
                                        () =>
                                          api(`/sessions/${s.id}/cancel`, {
                                            method: "POST",
                                            body: {},
                                          }),
                                        "Booking cancelled",
                                      )
                                    }
                                  >
                                    Cancel
                                  </Button>
                                )}
                              {s.status === "CONFIRMED" &&
                                ended &&
                                !s.my_confirmation && (
                                  <Button
                                    onClick={() =>
                                      run(
                                        () =>
                                          api(`/sessions/${s.id}/confirm`, {
                                            method: "POST",
                                            body: {},
                                          }),
                                        "Attendance confirmed",
                                      )
                                    }
                                  >
                                    Confirm attendance <Check size={15} />
                                  </Button>
                                )}
                              {s.status === "CONFIRMED" && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setModal({
                                      type: "action",
                                      title: "Open a dispute",
                                      field: "reason",
                                      label:
                                        "Tell the administrator what happened (10+ characters)",
                                      session: s,
                                      verb: "dispute",
                                    })
                                  }
                                >
                                  Report an issue
                                </button>
                              )}
                              {s.status === "COMPLETED" &&
                                !teacher &&
                                !s.rating && (
                                  <Button
                                    secondary
                                    onClick={() =>
                                      setModal({ type: "review", session: s })
                                    }
                                  >
                                    Leave a review <Star size={15} />
                                  </Button>
                                )}
                            </div>
                          </article>
                        );
                      })}
                  </div>
                  {!data.length && (
                    <Empty
                      title="Your calendar is full of possibility"
                      text="Request your first skill session to see it here."
                      action={
                        <Button onClick={() => nav("discover")}>
                          Discover skills
                        </Button>
                      }
                    />
                  )}
                </>
              )}
              {view === "teach" && (
                <>
                  <div className="section-title">
                    <div>
                      <h2>What can you share?</h2>
                      <p>
                        You don’t need to be an expert. Just one step ahead.
                      </p>
                    </div>
                    <Button onClick={() => setModal({ type: "offer" })}>
                      <Plus size={18} />
                      Add a skill
                    </Button>
                  </div>
                  <div className="cards">
                    {Array.isArray(data) &&
                      data.map((o) => (
                        <article className="panel" key={o.id}>
                          <span className="tag">
                            {o.active ? "Active" : "Paused"} · {o.mode}
                          </span>
                          <h3>{o.name}</h3>
                          <p>{o.description}</p>
                          <footer>
                            <Button
                              disabled={!o.active}
                              onClick={() =>
                                setModal({ type: "slot", offer: o })
                              }
                            >
                              Add availability <Plus size={15} />
                            </Button>
                            <button
                              className="text-button"
                              onClick={() =>
                                run(
                                  () =>
                                    api("/offers/" + o.id, {
                                      method: "PATCH",
                                      body: {
                                        description: o.description,
                                        active: !o.active,
                                      },
                                    }),
                                  "Offer updated",
                                )
                              }
                            >
                              {o.active ? "Pause" : "Resume"}
                            </button>
                          </footer>
                        </article>
                      ))}
                  </div>
                  {!data.length && (
                    <Empty
                      title="Your first skill belongs here"
                      text="Add something you enjoy teaching, then publish a one-hour slot."
                    />
                  )}
                </>
              )}
              {view === "credits" && data.wallet && (
                <>
                  <div className="wallet-banner">
                    <div>
                      <span>YOUR LEARNING WALLET</span>
                      <h2>
                        {data.wallet.available}
                        <small>available credits</small>
                      </h2>
                      <p>
                        Teach one hour. Learn one hour. Keep the exchange going.
                      </p>
                    </div>
                    <div>
                      <strong>{data.wallet.held_balance}</strong>
                      <span>held for bookings</span>
                      <strong>{data.wallet.balance}</strong>
                      <span>total balance</span>
                    </div>
                  </div>
                  <div className="section-title">
                    <h2>Credit activity</h2>
                    <span className="muted">
                      Learning credits have no cash value
                    </span>
                  </div>
                  <div className="panel ledger">
                    {data.transfers.map((t) => (
                      <div key={t.id}>
                        <div className="stat-icon purple">
                          <ArrowLeftRight size={18} />
                        </div>
                        <div>
                          <strong>
                            {t.type === "GRANT"
                              ? "A little welcome from SkillSwap"
                              : t.payee_id === user.id
                                ? "You shared a skill"
                                : "You learned something new"}
                          </strong>
                          <p>
                            {when(t.created_at)}
                            {t.session_id ? " · Session #" + t.session_id : ""}
                          </p>
                        </div>
                        <b className={t.payee_id === user.id ? "positive" : ""}>
                          {t.payee_id === user.id ? "+" : "−"}
                          {t.amount}
                        </b>
                      </div>
                    ))}
                  </div>
                  <h3>Booking holds</h3>
                  <div className="panel">
                    {data.holds.length ? (
                      data.holds.map((h) => (
                        <p key={h.id}>
                          Session #{h.session_id}{" "}
                          <span className="tag">{h.status}</span> · 1 credit
                        </p>
                      ))
                    ) : (
                      <p>
                        No credit holds. Your balance is ready for your next
                        session.
                      </p>
                    )}
                  </div>
                </>
              )}
              {view === "challenges" && <ChallengePanel api={api} mount={mount} admin={user.role==='admin'} refresh={refresh}/>}
              {view === "profile" && data.email && (
                <ProfilePanel api={api} mount={mount}
                  data={data}
                  save={(d) =>
                    run(async () => {
                      await api("/me", { method: "PATCH", body: d });
                      await boot();
                      setView('discover');
                    }, "Profile updated")
                  }
                  logout={() =>
                    run(async () => {
                      if (session.hub) {
                        await fetch(session.hub_origin + "/api/auth/logout", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "X-CSRF-Token": csrf,
                          },
                          body: "{}",
                        });
                        location.assign(session.hub_origin + "/hub");
                        return;
                      }
                      await api("/auth/logout", { method: "POST", body: {} });
                      await boot();
                    }, "Signed out")
                  }
                />
              )}
              {view === "admin" && user.role === "admin" && data.users && (
                <AdminPortal data={data} api={api} refresh={refresh} bulk={<BulkSkills users={data.users} api={api} done={refresh} mount={mount}/>} moderation={<Admin data={data} run={run} setModal={setModal}/>} challenges={<ChallengePanel api={api} mount={mount} admin={true} refresh={refresh}/>}/>
              )}

            </>
          )}
          <footer className="page-footer">
            <span>SkillSwap · Learn. Teach. Grow.</span>
            <span>
              Learn generously. Grow together. <Sparkles size={13} />
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {member&&<Modal title={member.display_name} onClose={()=>setMember(null)}><p>{member.is_demo?'Fictional demo profile · ':''}{member.college} · {member.department} · {member.study_year}</p><p>{member.bio}</p><p>Learning goals: {member.learning_goals}</p>{member.media.map(f=>f.kind==='avatar'?<img className="profile-photo" key={f.id} src={`${mount}/api/media/${f.id}`} alt={member.display_name}/>:<p key={f.id}><a href={`${mount}/api/media/${f.id}`}>{f.title} ↓</a></p>)}</Modal>}
      {modal?.type === "login" && (
        <Login
          session={session}
          register={modal.register}
          close={() => setModal(null)}
          done={async () => {
            setModal(null);
            await boot();
            refresh();
          }}
        />
      )}
      {modal && modal.type !== "login" && (
        <WorkModal modal={modal} close={() => setModal(null)} run={run} />
      )}
    </div>
  );
}
function OrbitCode({code,setCode,state,busy}){
 const ref=useRef();useEffect(()=>{window.OrbitOTP.attach(ref.current)},[]);useEffect(()=>{window.OrbitOTP.setState(ref.current,state)},[state]);
 return <label>Verification code<div><input ref={ref} value={code} onChange={e=>{const v=e.target.value.replace(/\D/g,'').slice(0,6);setCode(v);if(v.length===6&&!busy){const form=e.target.form;setTimeout(()=>form?.requestSubmit(),0)}}} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required autoFocus/></div></label>;
}
function Login({ session, register: initial, close, done }) {
  const [register, setRegister] = useState(!!initial),
    [challenge, setChallenge] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(""),
    [checked, setChecked] = useState(false),
    [token, setToken] = useState("");
  const captcha = useRef();
  const [otpState,setOtpState]=useState('entry');
  useEffect(() => {
    if (session?.demo || challenge || !session?.site_key) return;
    let cancelled = false,
      widget;
    const render = () => {
      if (cancelled || !captcha.current) return;
      widget = window.grecaptcha.render(captcha.current, {
        sitekey: session.site_key,
        callback: setToken,
        "expired-callback": () => setToken(""),
      });
    };
    if (window.grecaptcha?.render) render();
    else {
      window.skillSwapCaptchaReady = render;
      const s = document.createElement("script");
      s.src =
        "https://www.google.com/recaptcha/api.js?onload=skillSwapCaptchaReady&render=explicit";
      s.async = true;
      s.onerror = () => setError("Could not load reCAPTCHA. Retry.");
      document.head.append(s);
    }
    return () => {
      cancelled = true;
      if (widget !== undefined) window.grecaptcha?.reset(widget);
    };
  }, [challenge, session]);
  return (
    <Modal
      title={
        challenge
          ? "Check your inbox"
          : register
            ? "Welcome to the exchange"
            : "Good to see you again"
      }
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const d = Object.fromEntries(new FormData(e.currentTarget));
          try {
            if (challenge) {
              setOtpState('checking');
              await Promise.all([api("/auth/verify", {
                method: "POST",
                body: { challenge_id: challenge.challenge_id, code },
              }),new Promise(r=>setTimeout(r,900))]);
              setOtpState('success');await new Promise(r=>setTimeout(r,1100));
              await done();
            } else
              setChallenge(
                await api("/auth/request", {
                  method: "POST",
                  body: {
                    email: d.email,
                    captcha_token: session?.demo
                      ? checked
                        ? "local-preview"
                        : ""
                      : token,
                    ...(register
                      ? {
                          profile: {
                            display_name: d.display_name,
                            department: d.department,
                          },
                        }
                      : {}),
                  },
                }),
              );
          } catch (e) {
            setError(e.message);
            setOtpState('error');
            setToken("");
            if (window.grecaptcha)
              try {
                window.grecaptcha.reset();
              } catch {}
          } finally {
            setBusy(false);
          }
        }}
      >
        {!challenge ? (
          <>
            {register && (
              <>
                <label>
                  Your name
                  <input
                    name="display_name"
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Department
                  <input
                    name="department"
                    maxLength={100}
                    placeholder="Computer Science, Design…"
                  />
                </label>
              </>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@college.edu"
              />
            </label>
            {session?.demo ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I understand this is a local demo check.
              </label>
            ) : (
              <div ref={captcha} />
            )}
          </>
        ) : (
          <>
            <p>Enter the six-digit code. It expires in five minutes.</p>
            {challenge.preview_code && (
              <div className="demo-code">
                LOCAL DEMO CODE: <strong>{challenge.preview_code}</strong>
              </div>
            )}
            <OrbitCode code={code} setCode={setCode} state={otpState} busy={busy}/>

          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy || !session}>
          {busy
            ? "Please wait…"
            : challenge
              ? "Verify & continue"
              : "Send verification code"}
          <ArrowRight size={16} />
        </Button>
        {!challenge && (
          <button
            type="button"
            className="text-button"
            onClick={() => setRegister(!register)}
          >
            {register
              ? "Already a member? Sign in"
              : "New here? Create your profile"}
          </button>
        )}
        {challenge && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setChallenge(null);
              setOtpState('entry');
              setCode("");
            }}
          >
            Use another email or resend
          </button>
        )}
      </form>
    </Modal>
  );
}
function WorkModal({ modal: m, close, run }) {
  const [busy, setBusy] = useState(false),
    [modalError, setModalError] = useState("");
  return (
    <Modal
      title={
        m.title ||
        {
          book: "Make time for " + m.offer?.name,
          offer: "Share a skill",
          slot: "Publish a one-hour slot",
          review: "How was your session?",
          resolve: "Resolve this dispute",
        }[m.type]
      }
      onClose={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          const failure = await run(
            async () => {
              if (m.type === "book")
                await api("/sessions", {
                  method: "POST",
                  body: { slot_id: Number(d.slot_id) },
                });
              if (m.type === "offer")
                await api("/offers", { method: "POST", body: d });
              if (m.type === "slot")
                await api(`/offers/${m.offer.id}/slots`, {
                  method: "POST",
                  body: { start_at: new Date(d.start_at).toISOString() },
                });
              if (m.type === "action")
                await api(`/sessions/${m.session.id}/${m.verb}`, {
                  method: "POST",
                  body: d,
                });
              if (m.type === "review")
                await api("/reviews", {
                  method: "POST",
                  body: {
                    session_id: m.session.id,
                    rating: Number(d.rating),
                    text: d.text,
                  },
                });
              if (m.type === "resolve")
                await api("/admin/disputes/" + m.id, {
                  method: "POST",
                  body: d,
                });
            },
            m.type === "book"
              ? "Request sent. Your teacher will confirm the session."
              : "Saved successfully",
          );
          setModalError(failure || "");
          setBusy(false);
        }}
      >
        {m.type === "book" && (
          <>
            <p>
              1 credit is held only when your teacher accepts. Times below are
              in IST.
            </p>
            {m.slots.length ? (
              <label>
                Choose your session
                <select name="slot_id" required>
                  {m.slots.map((s) => (
                    <option value={s.id} key={s.id}>
                      {when(s.start_at)} · 60 minutes
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>No available slots. Check back later.</p>
            )}
          </>
        )}
        {m.type === "offer" && (
          <>
            <label>
              Skill name
              <input
                name="name"
                placeholder="e.g. Figma fundamentals"
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Category
                <select name="category">
                  {Object.keys(icons).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Level
                <select name="level">
                  <option>Beginner</option>
                  <option>Intermediate</option>
                  <option>Advanced</option>
                </select>
              </label>
            </div>
            <label>
              Format
              <select name="mode">
                <option>Online</option>
                <option>Campus</option>
              </select>
            </label>
            <label>
              What will someone learn?
              <textarea
                name="description"
                minLength={15}
                maxLength={2000}
                required
                placeholder="Give your learner a clear idea of the session…"
              />
            </label>
          </>
        )}
        {m.type === "slot" && (
          <>
            <p>
              Choose a start time in your device’s local timezone. Every session
              lasts 60 minutes.
            </p>
            <label>
              Start time
              <input
                type="datetime-local"
                name="start_at"
                required
                min={new Date(
                  Date.now() - new Date().getTimezoneOffset() * 60000,
                )
                  .toISOString()
                  .slice(0, 16)}
              />
            </label>
          </>
        )}
        {m.type === "action" && (
          <label>
            {m.label}
            <textarea
              name={m.field}
              minLength={m.field === "reason" ? 10 : 3}
              maxLength={m.field === "reason" ? 2000 : 1000}
              required
            />
          </label>
        )}
        {m.type === "review" && (
          <>
            <label>
              Your rating
              <select name="rating">
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} stars
                  </option>
                ))}
              </select>
            </label>
            <label>
              What helped you learn?
              <textarea name="text" maxLength={2000} />
            </label>
          </>
        )}
        {m.type === "resolve" && (
          <>
            <label>
              Decision
              <select name="decision">
                <option value="SETTLE">
                  Complete session and settle 1 credit
                </option>
                <option value="CANCEL">Cancel and release the hold</option>
              </select>
            </label>
            <label>
              Reason for your decision
              <textarea
                name="reason"
                minLength={10}
                maxLength={2000}
                required
              />
            </label>
          </>
        )}
        {modalError && (
          <p className="error" role="alert">
            {modalError}
          </p>
        )}
        <Button disabled={busy || (m.type === "book" && !m.slots.length)}>
          {busy
            ? "Saving…"
            : m.type === "book"
              ? "Request session"
              : "Save & continue"}
          <ArrowRight size={16} />
        </Button>
      </form>
    </Modal>
  );
}
function Admin({ data, run, setModal }) {
  const bad = data.reconciliation.filter(
    (w) => w.balance !== w.ledger_balance || w.held_balance !== w.ledger_held,
  );
  return (
    <>
      <div className={bad.length ? "error" : "success"}>
        <ShieldCheck size={18} />
        {bad.length
          ? "Wallet reconciliation mismatch — investigate before settling."
          : "Wallet balances and active holds reconcile with the ledger."}
      </div>
      <h2>Disputes</h2>
      {data.disputes.length ? (
        data.disputes.map((d) => (
          <article className="panel" key={d.id}>
            <span className="tag">{d.status}</span>
            <h3>
              {d.name} · Session #{d.session_id}
            </h3>
            <p>{d.reason}</p>
            {d.status === "OPEN" ? (
              <Button
                onClick={() => setModal({ type: "resolve", id: d.session_id })}
              >
                Review & resolve
              </Button>
            ) : (
              <p>
                {d.decision}: {d.admin_reason}
              </p>
            )}
          </article>
        ))
      ) : (
        <Empty
          title="No disputes to resolve"
          text="When someone needs help with an exchange, it appears here."
        />
      )}
      <h2>Community</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.display_name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.active ? "Active" : "Suspended"}</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() =>
                      run(
                        () =>
                          api("/admin/users/" + u.id, {
                            method: "PATCH",
                            body: { active: !u.active },
                          }),
                        "Member updated",
                      )
                    }
                  >
                    {u.active ? "Suspend" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Skill moderation</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {data.offers.map((o) => (
              <tr key={o.id}>
                <td>{o.name}</td>
                <td>{o.display_name}</td>
                <td>{o.active ? "Active" : "Paused"}</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() =>
                      run(
                        () =>
                          api("/admin/offers/" + o.id, {
                            method: "PATCH",
                            body: { active: !o.active },
                          }),
                        "Offer updated",
                      )
                    }
                  >
                    {o.active ? "Pause" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Learning activity</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Skill</th>
              <th>Offers</th>
              <th>Completed sessions</th>
            </tr>
          </thead>
          <tbody>
            {data.popular.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.offers}</td>
                <td>{s.completed_sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Awaiting confirmation over 48 hours: {data.stalled.length}</h3>
      <p className="muted">
        These sessions remain unsettled. Participants can open a dispute for
        review.
      </p>
      <details>
        <summary>Administrative audit trail ({data.audit.length})</summary>
        <div className="table-wrap">
          <table>
            <tbody>
              {data.audit.map((a) => (
                <tr key={a.id}>
                  <td>{when(a.created_at)}</td>
                  <td>{a.action}</td>
                  <td>
                    {a.entity_type} #{a.entity_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
