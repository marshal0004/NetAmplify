# NetAmplify — Frontend Specification (v1.0)

> Status: LOCKED for MVP. Companion docs: `02-SRS.md` (FRs that drive
> screens), `03-ARCHITECTURE.md` (folder structure + integration), `05-API-SPEC.md`
> (endpoints the UI calls), `12-TRUST-COPY.md` (verbatim trust copy).

---

## 1. Design System

### 1.1 Palette

| Token | Hex | Usage |
|---|---|---|
| `primary` | `#4F46E5` (indigo-600) | primary buttons, active states, focus rings |
| `primary-hover` | `#4338CA` (indigo-700) | hover state of primary |
| `primary-soft` | `#EEF2FF` (indigo-50) | backgrounds of selected cards, chip backgrounds |
| `success` | `#16A34A` (green-600) | SUCCESS status chip |
| `success-bg` | `#F0FDF4` (green-50) | success banner background |
| `error` | `#DC2626` (red-600) | FAILED status chip, destructive buttons |
| `error-bg` | `#FEF2F2` (red-50) | error banner background |
| `warning` | `#D97706` (amber-600) | Setup-pending Tier B cards, retry hints |
| `warning-bg` | `#FFFBEB` (amber-50) | warning banner background |
| `text` | `#111827` (gray-900) | primary text |
| `text-muted` | `#6B7280` (gray-500) | secondary text, captions |
| `surface` | `#FFFFFF` | card backgrounds |
| `page-bg` | `#F9FAFB` (gray-50) | page background |
| `border` | `#E5E7EB` (gray-200) | card borders, dividers |
| `border-strong` | `#D1D5DB` (gray-300) | input focus border |

**Dark mode**: not in MVP. Design tokens via CSS vars in `globals.css`
so adding dark mode later is a token flip, not a refactor.

### 1.2 Typography

- **UI font**: Inter (loaded via `next/font/google`).
- **Mono font**: JetBrains Mono (for tech tags, char counters, platform
  handles).
- **Heading font**: Inter (semibold for h1–h3, regular for body).

Type scale (line-height ratio):

| Token | Size | Line | Weight | Usage |
|---|---|---|---|---|
| `h1` | 30px | 38px | 600 | landing hero, page titles |
| `h2` | 22px | 30px | 600 | section headings |
| `h3` | 17px | 26px | 600 | card titles, modal titles |
| `body` | 15px | 24px | 400 | default text |
| `small` | 13px | 20px | 400 | captions, helper text |
| `mono` | 13px | 20px | 400 | tech tags, char counters, handles |

### 1.3 Spacing & layout

- **Spacing grid**: 4px base. Common values: 4, 8, 12, 16, 24, 32, 48.
- **Radius**: 8px default; 12px for cards; 6px for chips/badges; 4px
  for inputs (subtle).
- **Border**: 1px solid `border` color.
- **Max content width**: 1200px (centered).
- **Dashboard layout** (≥1024px): main 2fr / side 1fr; gap 24px.
- **Sidebar** (≥1024px): 240px wide; collapses to bottom nav <1024px;
  collapses to hamburger <768px.

### 1.4 Components (shadcn/ui only — no other UI lib)

- **Button**: variants `primary` / `secondary` / `ghost` / `destructive`;
  sizes `sm` / `md` / `lg`; `disabled` shows spinner.
- **Input**: text/email/password/url; with label, helper, error
  message; char counter for textarea.
- **Textarea**: markdown editor + char counter; preview toggle.
- **Select**: native select styled (avoids Radix Select complexity for
  MVP).
- **Badge / Chip**: tech tags, platform chips, status chips (see 1.5).
- **Card**: rounded-12, border, padding 24; hover: shadow-sm.
- **Dialog** (Radix): confirm destructive actions (Disconnect, Delete
  account); modal width 480px.
- **Toast**: bottom-right, 4s auto-dismiss; `aria-live="polite"`.
- **Tabs** (Radix): settings page (Profile / Security & Connections /
  Danger Zone).
- **Table**: history list; sticky header on desktop.
- **Skeleton**: shimmer placeholder for every async surface.
- **DropdownMenu** (Radix): user menu (Profile, Settings, Logout).
- **Tooltip** (Radix): error details on FAILED chips; "Why is this
  safe?" expanders.

### 1.5 Status chips (system-wide)

| Status | Color | Animation | Accessories |
|---|---|---|---|
| `QUEUED` | gray | none | — |
| `PUBLISHING` | blue | pulse | spinner |
| `SUCCESS` | green | none | "View post" link button |
| `FAILED` | red | none | tooltip with error + Retry button |
| `SKIPPED` | gray | none | tooltip with reason |

Platform chip = platform icon (from `simple-icons`) + mono handle (e.g.,
`@alice_dev`).

---

## 2. Screens & States (every screen has loading/empty/error)

### Screen 1 — Landing (public)

**Route**: `/`

**Sections** (top to bottom):
1. **Hero**: "Post once. Get seen everywhere." + subtext "NetAmplify
   formats your project for Reddit, Discord, Dev.to, Telegram, Bluesky,
   Hashnode, X, and LinkedIn — in one click." + CTA buttons:
   "Get started" (primary, → /signup) and "How it works" (ghost,
   scroll to section).
2. **How it works** (3 steps with icons):
   - Step 1: "Connect your platforms once" (icon: link)
   - Step 2: "Compose a Post Card" (icon: edit)
   - Step 3: "Amplify to N platforms in one click" (icon: rocket)
3. **Platform logo row**: simple-icons for Reddit, Discord, Dev.to,
   Telegram, Bluesky, Hashnode, X, LinkedIn (grayscale).
4. **Trust blurb** (centered, 2 sentences): "We never see your
   passwords. Each platform uses OAuth or a key you generate yourself,
   AES-256 encrypted, revocable anytime." + "See how →" link to
   trust details.
5. **Footer**: copyright, GitHub link, privacy policy stub.

**States**: N/A (static page).

### Screen 2 — Login / Signup / Reset

**Routes**: `/login`, `/signup`, `/reset`

**Layout**: centered card (max 400px) on page-bg.

**Login fields**:
- Email (input with label)
- Password (input with label + "show" toggle)
- Submit button (primary, "Log in")
- Below: "Don't have an account? Sign up" link

**Signup fields**:
- Name (input with label)
- Email (input with label)
- Password (input with label + "show" toggle + strength meter)
- Submit button (primary, "Create account")
- Below: "Already have an account? Log in" link

**Reset fields**:
- Email (input)
- Submit (primary, "Send reset link")
- On submit: show success message "If that email exists, a reset link
  is on its way." (regardless of whether the account exists — no
  enumeration).

**States**:
- Loading: submit button shows spinner, disabled.
- Error: inline `fieldErrors` below each field (red text).
- Auth error: toast at top "Invalid email or password".

### Screen 3 — Dashboard

**Route**: `/dashboard`

**Layout**: auth-guarded shell (sidebar + main). Sidebar nav: Dashboard,
Post Cards (dropdown: All / New), Connections, History, Settings. Top
bar: logo, user dropdown (Profile, Settings, Logout).

**Sections**:
1. **Onboarding strip** (top, dismissible per user until all 3 done):
   - `[1 Create profile]` (green if Profile has any field filled)
   - `[2 Connect platforms]` (green if ≥1 Connection ACTIVE)
   - `[3 Amplify first project]` (green if ≥1 Post exists)
2. **Stats strip** (S2): posts count, success rate, per-platform counts.
3. **Post Cards grid**: cards with title, summary, tech tags (3 chips +
   "+N more"), updatedAt, "Amplify" + "Edit" buttons.

**States**:
- Loading: 6 skeleton cards.
- Empty: "No post cards yet → create your first" with primary "New
  Post Card" button.
- Error: error banner with retry.

### Screen 4 — Connect Checklist

**Route**: `/dashboard/connections`

**Layout**: grid of platform cards (3 cols desktop, 2 cols tablet, 1
col mobile). Progress bar at top "3/6 connected".

**Per-card states**:
- **(a) Not connected**: platform icon, name, "Connect" button
  (primary), "Why is this safe?" expander (ghost button → tooltip
  with copy from `12-TRUST-COPY.md` §1).
- **(b) Connected**: green check + "Connected as @handle" + mono
  handle + "Disconnect" button (ghost).
- **(c) Setup pending** (Tier B unconfigured): amber state, disabled
  "Connect" button, "Coming soon" tooltip with "App review pending"
  message.

**Validation feedback**:
- Discord: after valid webhook, "Will post to #channel in Server".
- Telegram: errors map to precise hints (BAD_TOKEN / NOT_ADMIN /
  BAD_CHANNEL per FR-007).
- All: after invalid credential, red error message + "Try again".

**States**:
- Loading: skeleton cards.
- Empty: N/A (always shows all 8 platforms).
- Error: per-card error message; global error toast if fetch fails.

### Screen 5 — Composer (new / edit)

**Route**: `/dashboard/postcards/new`, `/dashboard/postcards/:id/edit`

**Sections**:
1. **Basics**: title input (with `42/120` char counter), summary
   input (`87/200` counter).
2. **Story**: description textarea (markdown, `0/5000` counter),
   "Preview" toggle shows rendered markdown (sanitized).
3. **Tech tags**: chips input; type + Enter to add; max 10 chips;
   kebab-case hint; remove chip on click.
4. **Links**: repoUrl, liveUrl (URL validation client-side; server is
   source of truth).
5. **Image** (S3): optional; drag-drop or click; preview thumbnail;
   remove button; 5MB / jpg/png/webp validation.
6. **Save** button (primary); Cancel link.

**States**:
- Loading: form disabled while saving.
- Validation: inline field errors below each field (client + server).
- Success: toast "Saved" + redirect to view page.

### Screen 6 — Publish (the core screen)

**Route**: `/dashboard/postcards/:id/publish`

**Layout**: 2-col (left: Post Card summary, right: platform checklist +
previews), bottom bar with Amplify button.

**Left column** — Post Card summary:
- Title, summary, tech tags (chips), repo/live links, image (if any).
- "Edit card" link (ghost).

**Right column** — platform checklist:
- Only connected platforms (Status ACTIVE) selectable.
- Each platform row: checkbox, platform icon, name, live preview panel
  (collapsible), char counter.
- Reddit row: extra input "Subreddit" (default to last-used for this
  user; required if Reddit checked).
- Live preview: calls `GET /api/postcards/:id/preview?platform=X`
  with debounce 300ms; shows formatted output + `charCount/limit`
  counter (red if over).
- "🚀 Amplify to N platforms" button (N live count of selected).

**After click Amplify**:
- Bottom bar transitions to inline status board (replaces the
  Amplify button).
- Status board: one row per platform, status chip + permalink button
  (if SUCCESS) + error tooltip + Retry (if FAILED).
- Polls `GET /api/posts/:id` every 3s; stops when all terminal.
- Partial-success banner (amber) if any FAILED: "Some platforms
  failed — retry them individually."

**States**:
- Loading: skeletons for previews while debounced.
- Empty: "No connected platforms → connect one to amplify" with link
  to /dashboard/connections.
- Error: per-platform error from `errorClass` mapped to message per
  `07-SECURITY-ACCESS.md` §4.

### Screen 7 — History

**Route**: `/dashboard/history`

**Layout**: table (date, title, per-platform chips, links, Retry).

**Columns** (desktop):
- Date (createdAt, formatted with `Intl.DateTimeFormat`)
- Title (Post Card title, links to Post Card view)
- Platforms (chips: REDDIT + status color)
- Permalinks (if SUCCESS: "View post" link per platform)
- Actions (Retry button if any FAILED target)

**Filters** (top bar):
- Platform select (All / REDDIT / DISCORD / ...)
- Status select (All / SUCCESS / FAILED / SKIPPED)
- Search input (filters by Post Card title — stretch)

**Pagination**: 20 per page; numbered pages; "← Older" / "Newer →".

**States**:
- Loading: 5 skeleton rows.
- Empty: "No posts yet → amplify your first post card" with link to
  dashboard.
- Error: error banner with retry.

### Screen 8 — Settings

**Route**: `/dashboard/settings`

**Layout**: Tabs (Profile / Security & Connections / Danger Zone).

**Profile tab**: same form as composer profile fields. Save button.

**Security & Connections tab**:
- Per-connection card: platform icon, handle, scopes granted (OAuth),
  connectedAt, lastUsedAt, lastValidatedAt, big Disconnect button
  (destructive).
- "How we protect you" section (verbatim from `12-TRUST-COPY.md` §2).
- Disconnect confirmation: Dialog "Disconnect {Platform}? Future
  publishes won't include it." with "Disconnect" / "Cancel".

**Danger Zone tab**:
- **Export data** button (secondary) → triggers download of
  `/api/account/export` JSON.
- **Delete account** button (destructive) → Dialog with text input
  "Type DELETE to confirm" → on submit, `DELETE /api/account` →
  redirect to landing.

**States**:
- Loading: skeleton for each tab.
- Error: per-field errors (Profile), per-action error toast.

---

## 3. Integration Spec (what the frontend calls)

### 3.1 NextAuth session endpoints

- `POST /api/auth/signup` (custom — not NextAuth)
- `GET/POST /api/auth/[...nextauth]` (NextAuth — login, logout,
  session, csrf)
- `POST /api/auth/reset-request`, `POST /api/auth/reset-confirm`
  (custom)

Session cookie is HttpOnly; client never reads it. Use `next-auth/react`
`useSession()` hook for client-side session state.

### 3.2 Internal `/api/*` endpoints

Per `05-API-SPEC.md`. Frontend uses a typed client
(`src/lib/api/client.ts`) that wraps `fetch` with:
- Credentials: same-origin (session cookie)
- Error envelope parsing (`{ error: { code, message, fieldErrors } }`)
- Throw on non-2xx; consumer catches and renders
- Typed responses via Zod schemas (the SAME schemas as server, shared
  from `src/lib/validation/schemas.ts`)

### 3.3 OAuth connects are full-page redirects

```typescript
// On clicking "Connect Reddit":
window.location.href = '/api/oauth/reddit/start';

// NOT:
fetch('/api/oauth/reddit/start');  // FORBIDDEN — platform login pages
                                    // can't be iframed, and redirect
                                    // must be top-level for OAuth
```

After callback, server redirects to `/dashboard/connections?connected=reddit`.
UI shows a success toast.

### 3.4 Image upload

- MVP: 1 image per Post Card.
- Upload via `POST /api/postcards/:id/image` (multipart/form-data) →
  returns `{ imageUrl }`.
- Client validation BEFORE upload: max 5MB, jpg/png/webp only. Show
  inline error if invalid; never call the API for invalid files.
- Server validation: same + magic-byte check (don't trust Content-
  Type).
- Storage: local disk `/public/uploads/<userId>/<cuid>.<ext>` in dev;
  Cloudinary interface in prod (config-only swap).

### 3.5 Polling (publish status)

```typescript
// usePostStatus(postId) hook
useEffect(() => {
  if (!postId) return;
  let active = true;
  let timeoutId: NodeJS.Timeout;
  const start = Date.now();

  const poll = async () => {
    if (Date.now() - start > 5 * 60 * 1000) return; // max 5 min
    const post = await api.getPost(postId);
    if (!active) return;
    setPost(post);
    if (post.targets.every(t => isTerminal(t.status))) return; // stop
    timeoutId = setTimeout(poll, 3000);
  };

  poll();
  return () => {
    active = false;
    clearTimeout(timeoutId);
  };
}, [postId]);
```

`isTerminal = (s) => ['SUCCESS','FAILED','SKIPPED'].includes(s)`.

### 3.6 Toast announcements (a11y)

All toasts use `aria-live="polite"` and `role="status"`. Errors use
`aria-live="assertive"` and `role="alert"`.

---

## 4. Responsive & A11y

### 4.1 Responsive breakpoints

- `<640px` (mobile): single column everywhere; dashboard sidebar
  collapses to hamburger; composer stacks vertically; publish page
  stacks vertically.
- `640–1024px` (tablet): 2-col grids; sidebar becomes icon-only.
- `≥1024px` (desktop): full layout per §1.3.

### 4.2 A11y requirements (enforced by Playwright + axe-core)

- **Labels**: every input has `<label for=...>` (or `aria-label` for
  icon-only buttons).
- **Keyboard**: every interactive element reachable via Tab; every
  action operable via Enter / Space; no keyboard traps.
- **Focus**: `:focus-visible` rings on all interactive elements (2px
  primary color, 2px offset).
- **Contrast**: AA (4.5:1 body text; 3:1 large text + UI components).
- **Toasts**: `aria-live="polite"` (info) / `assertive` (error).
- **Status chips**: `aria-label="Status: success"` (or queued / etc.).
- **Forms**: error messages linked via `aria-describedby`.
- **Modals**: focus trap; Escape to close; focus returns to trigger.
- **Images**: `alt` text; decorative images: `alt=""`.
- **Dynamic content**: announce status changes (e.g., "Publishing to
  Reddit...") via `aria-live` regions.

### 4.3 Lighthouse targets

| Category | Min score |
|---|---|
| Performance | 90 |
| Accessibility | 95 |
| Best Practices | 95 |
| SEO | 80 (landing only — app pages are noindex) |

Measured on the dashboard page (most complex) with default mobile
emulation.

---

## 5. Copy (user-facing strings)

All user-facing strings live in `src/lib/copy.ts`:

```typescript
export const copy = {
  landing: {
    heroTitle: "Post once. Get seen everywhere.",
    heroSubtitle: "NetAmplify formats your project for Reddit, Discord, Dev.to, Telegram, Bluesky, Hashnode, X, and LinkedIn — in one click.",
    ctaPrimary: "Get started",
    ctaSecondary: "How it works",
    trustBlurb: "We never see your passwords. Each platform uses OAuth or a key you generate yourself, AES-256 encrypted, revocable anytime.",
    // ... etc
  },
  dashboard: {
    title: "Your post cards",
    empty: "No post cards yet",
    emptyCta: "Create your first",
    // ... etc
  },
  publish: {
    amplify: "🚀 Amplify to N platforms",
    publishing: "Amplifying...",
    partialFailure: "Some platforms failed — retry them individually.",
    // ... etc
  },
  // ... etc
} as const;
```

Rationale: future i18n (post-MVP) is a flat-file swap, not a refactor.
Trust copy from `12-TRUST-COPY.md` is imported verbatim (not
re-typed) via a `trustCopy` export.

---

## 6. State management

- **Server state**: TanStack Query (React Query v5) for all `/api/*`
  data. Cache keys: `[resource, id?, params?]`. Default stale-while-
  revalidate.
- **Form state**: React Hook Form + Zod resolver. Schema is the SAME
  Zod schema from `src/lib/validation/schemas.ts` (shared with
  server).
- **Local UI state**: React `useState` for ephemeral state (modal
  open, preview toggle, etc.). No Redux, no Zustand.
- **Auth state**: `next-auth/react` `useSession()`.

---

## 7. Loading + error + empty pattern (mandatory per screen)

Every screen has three async-boundary states:

```tsx
// Pattern (simplified):
function DashboardPage() {
  const { data, isLoading, error, refetch } = usePostCards();

  if (isLoading) return <PostCardGridSkeleton />;
  if (error) return <ErrorBanner message={error.message} onRetry={refetch} />;
  if (!data.items.length) return <EmptyState
    title="No post cards yet"
    cta={<Button onClick={...}>Create your first</Button>}
  />;
  return <PostCardGrid items={data.items} />;
}
```

This pattern is enforced by code review. No screen may skip a state.

---

## 8. Component checklist (shadcn/ui primitives to install)

Per `03-ARCHITECTURE.md` §5 (folder `src/components/ui/`):

- button.tsx
- input.tsx
- textarea.tsx
- label.tsx
- card.tsx
- badge.tsx
- dialog.tsx
- dropdown-menu.tsx
- tabs.tsx
- table.tsx
- skeleton.tsx
- tooltip.tsx
- toast.tsx (via `sonner` — single dependency exception, pre-approved)
- select.tsx (native styled)
- checkbox.tsx
- switch.tsx (for "preview toggle")
- avatar.tsx (for user menu)

Install via `npx shadcn@latest add <component>` (NOT a npm install —
this is a dev tool that copies components into our repo).

---

> End of frontend spec. Next: `07-SECURITY-ACCESS.md` — auth, roles,
> isolation rules, error matrix, edge cases, threat checklist.
