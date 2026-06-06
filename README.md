# Just Us — Private Couples Chat 💬

A private, real-time chat app for two people (WhatsApp/Instagram-DM style), built
with **Next.js 16 + Supabase** and ready to deploy on **Vercel**.

**Features:** email sign-up, partner pairing by invite code, real-time text chat,
typing indicators, online presence, read receipts, photo/file sharing, voice
messages, and voice/video calls (WebRTC).

**Privacy:** every couple's data is isolated by Postgres **Row Level Security** —
even with the public API key, no one can read another couple's messages or media.
Media lives in a **private** Storage bucket served via short-lived signed URLs.

---

## 1. Prerequisites

- Node.js 18+ (you have v21)
- A free [Supabase](https://supabase.com) account
- A free [Vercel](https://vercel.com) account (for deployment)

---

## 2. Set up Supabase (one time, ~5 min)

1. Create a new project at <https://supabase.com/dashboard>.
2. Open **SQL Editor** → **New query**, paste the entire contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and
   click **Run**. This creates the tables, security policies, the `media`
   bucket, and enables real-time.
3. **Auth settings** (for instant sign-in during testing):
   **Authentication → Sign In / Providers → Email** → turn **off**
   "Confirm email". (Leave it on in production if you prefer email verification.)
4. Grab your keys from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)

---

## 3. Configure environment

```bash
cp .env.local.example .env.local
```

Open `.env.local` and paste in the three Supabase values from step 2.
(`NEXT_PUBLIC_TURN_SERVERS` is only needed for reliable calls — see step 6.)

---

## 4. Run it locally

```bash
npm install   # already done if you scaffolded here
npm run dev
```

Open <http://localhost:3000>.

### Two-user test (the fun part)

1. In a **normal** browser window, sign up as Person A.
2. In an **incognito/private** window, sign up as Person B.
3. As Person A → **Share my code** → **Generate my code** → copy it.
4. As Person B → **Enter their code** → paste → **Link with partner**.
5. Both land in the chat. Try:
   - Sending text — appears instantly on both sides, with ✓✓ read receipts.
   - The typing indicator while the other types.
   - Sending a photo/file (📎) and a voice message (🎙).
   - A voice (📞) or video (🎥) call.

### Privacy check

Sign up a **third** unrelated account — it can't see or open the couple's
messages or media. Row Level Security denies access at the database level.

---

## 5. Deploy to Vercel

1. Push this `couples-chat` folder to a GitHub repo.
2. In Vercel: **Add New → Project → Import** the repo.
3. Add the same env vars (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
   `NEXT_PUBLIC_TURN_SERVERS`) under **Settings → Environment Variables**.
4. Deploy. Add your Vercel URL to Supabase **Authentication → URL Configuration**
   (Site URL + Redirect URLs).
5. Open the live URL and run the same two-user test. On a phone, use the browser
   menu → **Add to Home Screen** to install it as an app.

---

## 6. Voice/Video calls — TURN server (recommended)

Calls use WebRTC peer-to-peer with Supabase Realtime for the signaling
handshake. STUN alone (the default) connects on many home networks, but mobile
networks and strict firewalls need a **TURN** relay.

Get free TURN credentials from [Metered OpenRelay](https://www.metered.ca/tools/openrelay/)
(or Twilio), then set `NEXT_PUBLIC_TURN_SERVERS` to a JSON array, e.g.:

```
NEXT_PUBLIC_TURN_SERVERS=[{"urls":"turn:your.turn.server:3478","username":"user","credential":"pass"}]
```

---

## 7. How privacy works (summary)

- **Row Level Security** on every table — access is scoped to your couple via the
  `is_in_couple()` / `is_my_partner()` SQL helpers.
- **Pairing** is done through a `SECURITY DEFINER` function (`redeem_invite`) that
  enforces all checks (code valid, unused, not your own, neither already paired).
- **Private Storage bucket** + signed URLs for all media.
- **HTTPS** everywhere (Vercel + Supabase).
- **Optional upgrade:** true end-to-end encryption (encrypt message bodies with a
  shared key derived at pairing time) so even the database owner can't read them.
  Not in v1 — documented as a follow-on.

---

## Project structure

```
src/
  app/
    (auth)/login, (auth)/signup, (auth)/actions.ts   – auth screens + server actions
    pair/                                             – invite generate/redeem
    chat/                                             – chat page (server)
    page.tsx                                          – routes by session/pairing state
    layout.tsx, globals.css
  components/                                         – AuthForm, PairPanel, ChatRoom,
                                                        ChatHeader, MessageBubble,
                                                        Composer, CallModal
  lib/
    supabase/ client.ts, server.ts, middleware.ts     – Supabase clients + session refresh
    data.ts, storage.ts, types.ts, webrtc.ts          – helpers + WebRTC call manager
  proxy.ts                                            – route guard (Next.js 16 "proxy")
supabase/migrations/0001_init.sql                     – schema + RLS + storage + realtime
public/manifest.webmanifest, icons/                   – PWA install
```
