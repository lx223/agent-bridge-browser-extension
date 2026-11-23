import { AbsoluteFill, Animate, Composition, Easing, Img, Sequence, interpolate, pop, registerRoot, rise, slide, useCurrentFrame } from "raea";
import icon from "../packages/extension/safari-app/AppIcon.appiconset/icon_512x512.png";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

const HOOK = { from: 0, length: 100 };
const STAGE = { from: 94, length: 670 };
const END = { from: 752, length: 150 };
const TOTAL = END.from + END.length;

const SANS = "Inter, sans-serif";
const DISPLAY = "'Inter Display', Inter, sans-serif";
const MONO = "'JetBrains Mono', monospace";

const INK = "#0f172a";
const INDIGO = "#4f46e5";
const SOFT_INDIGO = "#e0e7ff";
const BACKGROUND = "radial-gradient(1200px 600px at 85% -10%, #818cf8 0%, rgba(129, 140, 248, 0) 60%), linear-gradient(160deg, #4f46e5 0%, #312e81 100%)";
const OK = "#16a34a";

const OUT = Easing.out(Easing.cubic);
const IN_OUT = Easing.inOut(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const between = (f: number, from: number, to: number, a: number, b: number, easing = OUT) =>
  interpolate(f, [from, to], [a, b], { ...clamp, easing });

const appear = (f: number, at: number, frames = 8) => between(f, at, at + frames, 0, 1);

const typed = (text: string, f: number, at: number, perFrame = 1) => text.slice(0, Math.max(0, Math.floor((f - at) * perFrame)));

type Topic = "travel" | "work" | "recipes";

const GROUPS: Record<Topic, { title: string; color: string }> = {
  travel: { title: "Lisbon trip", color: "#1a73e8" },
  work: { title: "Q3 report", color: "#a142f4" },
  recipes: { title: "Dinner ideas", color: "#fa903e" },
};
const TOPICS: Topic[] = ["travel", "work", "recipes"];

const TABS: Array<{ title: string; topic: Topic }> = [
  { title: "Flights to Lisbon – compare prices", topic: "travel" },
  { title: "Q3 revenue dashboard", topic: "work" },
  { title: "Easy weeknight pasta", topic: "recipes" },
  { title: "Hotels in Alfama", topic: "travel" },
  { title: "Q3 report draft", topic: "work" },
  { title: "Roast vegetable tray bake", topic: "recipes" },
  { title: "Lisbon: top 10 things to do", topic: "travel" },
  { title: "Team meeting notes", topic: "work" },
];

const BEAT = {
  tidyPrompt: 18,
  tabsList: 48,
  planApply: 70,
  regroup: 80,
  tidyReply: 112,
  booking: 280,
  bookPrompt: 292,
  newTab: 316,
  snapshot: 336,
  typeName: 358,
  typeGuests: 386,
  typeWhen: 404,
  ask: 442,
  cursorIn: 458,
  click: 502,
  closePopover: 546,
  pageClick: 552,
  confirmation: 560,
  bookReply: 576,
  exit: 656,
};

const BROWSER = { left: 60, top: 222, width: 1800, height: 800 };
const STRIP = { height: 50, start: 96, gap: 4 };
const ADDRESS_HEIGHT = 50;
const TERMINAL = { left: 100, top: 352, width: 680, height: 600 };

function Background() {
  return <AbsoluteFill style={{ background: BACKGROUND }} />;
}

function Hook() {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      <Animate enter={pop()} at={0} exit="fade" exitAt={HOOK.length - 8}>
        <Img src={icon} style={{ width: 168, height: 168, borderRadius: 38 }} />
      </Animate>
      <Animate enter={rise({ distance: 36, frames: 10 })} at={6} exit="fade" exitAt={HOOK.length - 8} style={{ marginTop: 48, maxWidth: 1400, textAlign: "center", color: "#fff", fontFamily: DISPLAY, fontWeight: 700, fontSize: 84, lineHeight: 1.08, letterSpacing: -1.5 }}>
        Let your AI agent use the browser you already use.
      </Animate>
    </AbsoluteFill>
  );
}

function Caption({ f }: { f: number }) {
  const lines = [
    { at: 0, until: BEAT.booking, text: "Let your AI agent tidy your tabs" },
    { at: BEAT.booking, until: BEAT.ask, text: "Your agent works in real web pages" },
    { at: BEAT.ask, until: STAGE.length, text: "Confirm in the page you're looking at" },
  ];
  return (
    <>
      {lines.map((line) => {
        const opacity = Math.min(appear(f, line.at + 4, 8), 1 - appear(f, line.until - 6, 6));
        const y = between(f, line.at + 4, line.at + 14, 24, 0);
        return (
          <div key={line.text} style={{ position: "absolute", left: 60, right: 60, top: 118, textAlign: "center", color: "#fff", fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, lineHeight: 1.1, letterSpacing: -1, opacity, transform: `translateY(${y}px)` }}>
            {line.text}
          </div>
        );
      })}
    </>
  );
}

function tabLayout(f: number) {
  const grouped = between(f, BEAT.regroup, BEAT.regroup + 26, 0, 1, IN_OUT);
  const tabWidth = between(f, BEAT.newTab, BEAT.newTab + 12, 150, 122, IN_OUT);
  const chipWidth = 136;
  const step = tabWidth + STRIP.gap;
  const before = TABS.map((_, index) => STRIP.start + index * step);
  const after: number[] = [];
  const chips: Record<Topic, number> = { travel: 0, work: 0, recipes: 0 };
  let x = STRIP.start;
  for (const topic of TOPICS) {
    chips[topic] = x;
    x += chipWidth + STRIP.gap;
    TABS.forEach((tab, index) => {
      if (tab.topic !== topic) return;
      after[index] = x;
      x += step;
    });
  }
  const groupedEnd = x;
  const beforeEnd = STRIP.start + TABS.length * step;
  return {
    grouped,
    tabWidth,
    chipWidth,
    tabs: TABS.map((_, index) => before[index]! + (after[index]! - before[index]!) * grouped),
    chips,
    end: beforeEnd + (groupedEnd - beforeEnd) * grouped,
  };
}

function Favicon({ color, letter }: { color: string; letter: string }) {
  return (
    <div style={{ width: 18, height: 18, flex: "none", borderRadius: 5, backgroundColor: color, color: "#fff", fontFamily: SANS, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {letter}
    </div>
  );
}

function Tab({ x, width, title, active, color, underline, opacity = 1 }: { x: number; width: number; title: string; active: boolean; color: string; underline: number; opacity?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: 8, width, height: STRIP.height - 8, borderRadius: "10px 10px 0 0", backgroundColor: active ? "#fff" : "rgba(255,255,255,0)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", boxSizing: "border-box", opacity }}>
      <Favicon color={color} letter={title.charAt(0)} />
      <div style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: SANS, fontSize: 15, color: "#334155" }}>{title}</div>
      <div style={{ position: "absolute", left: 6, right: 6, bottom: 0, height: 3, borderRadius: 2, backgroundColor: color, opacity: underline }} />
    </div>
  );
}

function TabStrip({ f }: { f: number }) {
  const layout = tabLayout(f);
  const booking = f >= BEAT.newTab;
  const newTab = appear(f, BEAT.newTab, 10);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: STRIP.height, backgroundColor: "#dee1e6" }}>
      <div style={{ position: "absolute", left: 20, top: 19, display: "flex", gap: 8 }}>
        {["#f87171", "#fbbf24", "#34d399"].map((color) => <div key={color} style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: color }} />)}
      </div>
      {TOPICS.map((topic) => (
        <div key={topic} style={{ position: "absolute", left: layout.chips[topic], top: 15, height: 26, width: layout.chipWidth, borderRadius: 8, backgroundColor: GROUPS[topic].color, color: "#fff", fontFamily: SANS, fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", opacity: layout.grouped, transform: `scale(${0.8 + 0.2 * layout.grouped})` }}>
          {GROUPS[topic].title}
        </div>
      ))}
      {TABS.map((tab, index) => (
        <Tab key={tab.title} x={layout.tabs[index]!} width={layout.tabWidth} title={tab.title} active={!booking && index === 0} color={GROUPS[tab.topic].color} underline={layout.grouped} />
      ))}
      {booking && <Tab x={layout.end} width={layout.tabWidth + 30} title="Casa Azul – Reserve a table" active color="#0e7490" underline={0} opacity={newTab} />}
    </div>
  );
}

function AddressBar({ f }: { f: number }) {
  const url = f >= BEAT.newTab ? "casa-azul.example/reserve" : "flights.example/lisbon";
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: STRIP.height, height: ADDRESS_HEIGHT, backgroundColor: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", padding: "0 18px", gap: 14, boxSizing: "border-box" }}>
      <div style={{ fontFamily: SANS, fontSize: 20, color: "#475569" }}>←  →</div>
      <div style={{ flex: 1, height: 34, borderRadius: 17, backgroundColor: "#f1f3f4", display: "flex", alignItems: "center", padding: "0 18px", fontFamily: SANS, fontSize: 16, color: "#334155" }}>{url}</div>
      <Img src={icon} style={{ width: 26, height: 26, borderRadius: 6 }} />
    </div>
  );
}

function Lines({ widths, top }: { widths: number[]; top: number }) {
  return (
    <div style={{ position: "absolute", left: 0, top, display: "flex", flexDirection: "column", gap: 16 }}>
      {widths.map((width, index) => <div key={index} style={{ width, height: 14, borderRadius: 7, backgroundColor: "#e2e8f0" }} />)}
    </div>
  );
}

function FlightsPage({ opacity }: { opacity: number }) {
  return (
    <div style={{ position: "absolute", left: 790, top: 60, width: 860, opacity }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 40, color: INK }}>Flights to Lisbon</div>
      <div style={{ marginTop: 10, fontFamily: SANS, fontSize: 20, color: "#64748b" }}>Compare prices</div>
      <Lines top={130} widths={[760, 700, 740, 520, 680, 600, 720, 480]} />
    </div>
  );
}

function Field({ label, value, f, at, perFrame }: { label: string; value: string; f: number; at: number; perFrame: number }) {
  const shown = typed(value, f, at, perFrame);
  const focused = f >= at && f < at + Math.ceil(value.length / perFrame) + 6;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontFamily: SANS, fontSize: 18, fontWeight: 600, color: "#334155" }}>{label}</div>
      <div style={{ marginTop: 8, height: 52, borderRadius: 10, border: `2px solid ${focused ? INDIGO : "#cbd5e1"}`, display: "flex", alignItems: "center", padding: "0 16px", boxSizing: "border-box", fontFamily: SANS, fontSize: 20, color: INK, backgroundColor: "#fff" }}>
        {shown}
        {focused && <div style={{ width: 2, height: 24, marginLeft: 2, backgroundColor: INK }} />}
      </div>
    </div>
  );
}

function BookingPage({ f }: { f: number }) {
  const opacity = appear(f, BEAT.newTab + 4, 8);
  const done = appear(f, BEAT.confirmation, 8);
  return (
    <div style={{ position: "absolute", left: 790, top: 48, width: 520, opacity }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 44, color: "#0e7490" }}>Casa Azul</div>
      <div style={{ marginTop: 6, fontFamily: SANS, fontSize: 22, color: "#64748b" }}>Reserve a table</div>
      <Field label="Name" value="Ada Lovelace" f={f} at={BEAT.typeName} perFrame={0.8} />
      <Field label="Guests" value="4" f={f} at={BEAT.typeGuests} perFrame={1} />
      <Field label="When" value="Tonight, 7:30 pm" f={f} at={BEAT.typeWhen} perFrame={1} />
      <div style={{ marginTop: 30, width: 200, height: 56, borderRadius: 12, backgroundColor: "#0e7490", color: "#fff", fontFamily: SANS, fontWeight: 700, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${f >= BEAT.pageClick && f < BEAT.pageClick + 4 ? 0.95 : 1})` }}>
        Book table
      </div>
      <div style={{ marginTop: 24, padding: "16px 20px", borderRadius: 12, backgroundColor: "#f0fdf4", border: "2px solid #bbf7d0", fontFamily: SANS, fontSize: 20, fontWeight: 600, color: "#166534", opacity: done, transform: `translateY(${(1 - done) * 12}px)` }}>
        Table for 4 booked for Ada Lovelace. See you tonight!
      </div>
    </div>
  );
}

function Popover({ f }: { f: number }) {
  const show = appear(f, BEAT.ask + 6, 8);
  const hide = appear(f, BEAT.closePopover, 8);
  const answered = f >= BEAT.click + 4;
  const pressed = f >= BEAT.click && f < BEAT.click + 4;
  const y = (1 - show) * -16;
  return (
    <div style={{ position: "absolute", right: 28, top: 24, width: 420, borderRadius: 14, backgroundColor: "#fff", border: "1px solid #e7e5e4", boxShadow: "0 20px 50px rgba(15, 23, 42, 0.28)", overflow: "hidden", opacity: show * (1 - hide), transform: `translateY(${y}px)` }}>
      <div style={{ height: 38, backgroundColor: "#f5f5f4", display: "flex", alignItems: "center", gap: 10, padding: "0 14px", fontFamily: SANS, fontSize: 15, fontWeight: 600, color: "#57534e" }}>
        <Img src={icon} style={{ width: 20, height: 20, borderRadius: 5 }} />
        claude-code asks
      </div>
      <div style={{ padding: "16px 18px 18px", minHeight: 176, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {answered ? (
          <div style={{ fontFamily: SANS, fontSize: 19, fontWeight: 600, color: OK, textAlign: "center" }}>Confirmed. claude-code will go ahead.</div>
        ) : (
          <>
            <div style={{ fontFamily: SANS, fontSize: 21, fontWeight: 700, color: "#1c1917" }}>Book the table?</div>
            <div style={{ marginTop: 6, fontFamily: SANS, fontSize: 17, lineHeight: 1.4, color: "#57534e" }}>A table for 4 at Casa Azul tonight, 7:30 pm, under Ada Lovelace.</div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <div style={{ height: 40, padding: "0 16px", borderRadius: 9, border: "1px solid #d6d3d1", display: "flex", alignItems: "center", fontFamily: SANS, fontSize: 16, fontWeight: 600, color: "#1c1917" }}>Cancel</div>
              <div style={{ height: 40, padding: "0 16px", borderRadius: 9, backgroundColor: "#2563eb", display: "flex", alignItems: "center", fontFamily: SANS, fontSize: 16, fontWeight: 600, color: "#fff", transform: `scale(${pressed ? 0.94 : 1})` }}>Book table</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Cursor({ f }: { f: number }) {
  const travel = between(f, BEAT.cursorIn, BEAT.click - 6, 0, 1, IN_OUT);
  const x = 1420 + (1690 - 1420) * travel;
  const y = 720 + (196 - 720) * travel;
  const opacity = Math.min(appear(f, BEAT.cursorIn, 6), 1 - appear(f, BEAT.closePopover + 4, 8));
  const press = f >= BEAT.click && f < BEAT.click + 4 ? 0.85 : 1;
  return (
    <svg width="34" height="44" viewBox="0 0 34 44" style={{ position: "absolute", left: x, top: y, opacity, transform: `scale(${press})`, transformOrigin: "0 0" }}>
      <path d="M2 2 L2 34 L10 26 L16 40 L22 37 L16 24 L28 24 Z" fill="#111827" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function Browser({ f }: { f: number }) {
  const flights = 1 - appear(f, BEAT.newTab, 6);
  return (
    <div style={{ position: "absolute", ...BROWSER, borderRadius: 16, overflow: "hidden", backgroundColor: "#fff", boxShadow: "0 30px 80px rgba(15, 23, 42, 0.5)" }}>
      <TabStrip f={f} />
      <AddressBar f={f} />
      <div style={{ position: "absolute", left: 0, right: 0, top: STRIP.height + ADDRESS_HEIGHT, bottom: 0, overflow: "hidden" }}>
        <FlightsPage opacity={flights} />
        <BookingPage f={f} />
        <Popover f={f} />
        <Cursor f={f} />
      </div>
    </div>
  );
}

type Message = { kind: "user" | "agent"; text: string; at: number } | { kind: "tool"; name: string; detail?: string; at: number };

const TIDY: Message[] = [
  { kind: "user", text: "Organise my open tabs into groups by topic.", at: BEAT.tidyPrompt },
  { kind: "tool", name: "chrome_tabs_list", at: BEAT.tabsList },
  { kind: "tool", name: "chrome_plan_apply", detail: "Lisbon trip · Q3 report · Dinner ideas", at: BEAT.planApply },
  { kind: "agent", text: "Done. I grouped 8 tabs into 3 groups. Ask me to undo it if you want the old layout back.", at: BEAT.tidyReply },
];

const BOOK: Message[] = [
  { kind: "user", text: "Book a table for 4 at Casa Azul tonight under Ada Lovelace.", at: BEAT.bookPrompt },
  { kind: "tool", name: "chrome_tabs_create", detail: "casa-azul.example", at: BEAT.newTab },
  { kind: "tool", name: "chrome_page_snapshot", detail: "Casa Azul", at: BEAT.snapshot },
  { kind: "tool", name: "chrome_page_type", detail: "Name · Guests · When", at: BEAT.typeName },
  { kind: "tool", name: "browser_ask_user", detail: "Book the table?", at: BEAT.ask },
  { kind: "tool", name: "chrome_page_click", detail: "Book table", at: BEAT.pageClick },
  { kind: "agent", text: "Done. Casa Azul confirmed a table for 4 under Ada Lovelace.", at: BEAT.bookReply },
];

function Bubble({ message, f }: { message: Message; f: number }) {
  const opacity = appear(f, message.at, 6);
  const y = (1 - opacity) * 10;
  const base = { opacity, transform: `translateY(${y}px)` };
  if (message.kind === "tool") {
    return (
      <div style={{ ...base, display: "flex", alignItems: "baseline", gap: 10, fontFamily: MONO, fontSize: 19, color: "#a5b4fc" }}>
        <span style={{ color: "#34d399" }}>●</span>
        <span>{message.name}</span>
        {message.detail && <span style={{ color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{message.detail}</span>}
      </div>
    );
  }
  const user = message.kind === "user";
  return (
    <div style={{ ...base, alignSelf: user ? "flex-end" : "flex-start", maxWidth: "88%" }}>
      <div style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: "#94a3b8", textAlign: user ? "right" : "left", marginBottom: 6 }}>{user ? "YOU" : "AGENT"}</div>
      <div style={{ fontFamily: SANS, fontSize: 23, lineHeight: 1.4, color: user ? "#fff" : "#e2e8f0", backgroundColor: user ? INDIGO : "#1e293b", padding: "12px 16px", borderRadius: 14 }}>{message.text}</div>
    </div>
  );
}

function Terminal({ f }: { f: number }) {
  const tidyOut = appear(f, BEAT.booking, 8);
  return (
    <div style={{ position: "absolute", ...TERMINAL, borderRadius: 16, overflow: "hidden", backgroundColor: INK, boxShadow: "0 30px 80px rgba(2, 6, 23, 0.6)", border: "1px solid #1e293b" }}>
      <div style={{ height: 40, backgroundColor: "#1e293b", display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
        {["#f87171", "#fbbf24", "#34d399"].map((color) => <div key={color} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />)}
        <div style={{ marginLeft: 12, fontFamily: MONO, fontSize: 15, color: "#94a3b8" }}>claude-code · agent-browser-bridge</div>
      </div>
      <div style={{ position: "absolute", left: 22, right: 22, top: 62, display: "flex", flexDirection: "column", gap: 16, opacity: 1 - tidyOut, transform: `translateY(${-40 * tidyOut}px)` }}>
        {TIDY.map((message) => <Bubble key={message.at} message={message} f={f} />)}
      </div>
      <div style={{ position: "absolute", left: 22, right: 22, top: 62, display: "flex", flexDirection: "column", gap: 14 }}>
        {BOOK.map((message) => <Bubble key={message.at} message={message} f={f} />)}
      </div>
    </div>
  );
}

function Stage() {
  const f = useCurrentFrame();
  const enter = appear(f, 0, 14);
  const leave = appear(f, BEAT.exit, 12);
  const browserY = (1 - enter) * 60 - leave * 30;
  const terminalX = (1 - appear(f, 6, 14)) * -60;
  const zoom = interpolate(f, [0, STAGE.length], [1, 1.03], clamp);
  return (
    <AbsoluteFill style={{ opacity: Math.min(enter, 1 - leave), transform: `scale(${zoom})` }}>
      <Caption f={f} />
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${browserY}px)` }}>
        <Browser f={f} />
      </div>
      <div style={{ position: "absolute", inset: 0, transform: `translate(${terminalX}px, ${browserY}px)`, opacity: appear(f, 6, 10) }}>
        <Terminal f={f} />
      </div>
    </AbsoluteFill>
  );
}

function EndCard() {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, END.length], [1, 1.04], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: SANS, textAlign: "center", transform: `scale(${zoom})` }}>
      <Animate enter={pop()} at={0}>
        <Img src={icon} style={{ width: 176, height: 176, borderRadius: 40 }} />
      </Animate>
      <Animate enter={rise({ distance: 30, frames: 9 })} at={6} style={{ marginTop: 40, color: "#fff", fontFamily: DISPLAY, fontWeight: 700, fontSize: 96, lineHeight: 1.05, letterSpacing: -2 }}>
        Agent Browser Bridge
      </Animate>
      <Animate enter="fade" at={16} style={{ marginTop: 24, maxWidth: 1200, color: SOFT_INDIGO, fontSize: 36, lineHeight: 1.35 }}>
        <div>Works with Claude Code, Cursor, VS Code and any MCP client.</div>
        <div>Free and open source.</div>
      </Animate>
      <Animate enter={slide({ from: "bottom", distance: 30 })} at={30} style={{ marginTop: 52, display: "flex", alignItems: "center", gap: 18, padding: "20px 40px", borderRadius: 999, backgroundColor: "#fff", color: INDIGO, fontWeight: 700, fontSize: 36 }}>
        Add to Chrome from the Chrome Web Store
      </Animate>
    </AbsoluteFill>
  );
}

export default function Promo() {
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <Background />
      <Sequence from={HOOK.from} durationInFrames={HOOK.length} name="hook">
        <Hook />
      </Sequence>
      <Sequence from={STAGE.from} durationInFrames={STAGE.length} name="stage">
        <Stage />
      </Sequence>
      <Sequence from={END.from} durationInFrames={END.length} name="end card">
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="promo" component={Promo} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={TOTAL} />);
