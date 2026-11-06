# Wardrobe planner

A private web app that plans a Monday to Sunday of outfits from photos of your own clothes. It tracks what's been worn and what's clean, and a piece only comes back into outfits once it has been washed.

**Status:** phase 2 of 6. Sign-in works, and you can photograph your clothes and have AI label them. The planner, style, laundry and hand control are still to come.

## How a photo is handled

1. You take or choose a photo in the Wardrobe tab.
2. On your phone, the app shrinks it, redraws it (which drops location and camera details) and blurs any faces it finds. If the face check can't run, the photo isn't sent.
3. The photo goes to a private storage bucket that only your account can read.
4. A server function sends it to a vision model on Groq, which labels the type, a name, the colour, how formal it is, which occasions it suits, and whether it's patterned. The answer is checked against fixed lists before it's saved.
5. The app also measures the piece's real colours from the photo, on your phone.
6. You check the labels and fix anything that's wrong.

If the free Groq allowance runs out, photos wait and are read the next time the app is opened after it resets. Photograph pieces against a plain background with nothing personal in the shot.

## Stack

- React, TypeScript and Vite
- Supabase for sign-in, the wardrobe table and photo storage
- Groq (free tier) for labelling, behind a Vercel function so the key never reaches the browser
- MediaPipe face detection, running on the phone
- Vercel for hosting

## Run it locally

You need Node 22 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in the values in `.env.local`, then start the app:

```bash
npm run dev
```

Without the Supabase values, the app shows a screen explaining what's missing. Without the Groq key, photos are saved and wait to be read, and can be filled in by hand.

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Under **Authentication > Sign In / Providers**, turn off **Allow new users to sign up**. This app has one user.
3. Under **Authentication > Users**, add your user with **Auto Confirm User** ticked.
4. Open the **SQL Editor**, paste in `supabase/migrations/0001_wardrobe.sql` and run it. This creates the wardrobe table, the private photo bucket and the rules that keep both private to you.
5. Copy the project URL and the publishable key into `.env.local` and into Vercel's environment variables, as Config values.

Only ever use the publishable key or the legacy anon key. These values ship to the browser, so the build stops if it finds a secret key.

## Set up Groq

The Groq account must belong to an adult: Groq requires account holders to be 18 or older.

1. Create an API key in the [Groq console](https://console.groq.com/keys).
2. In the console's data controls, turn on Zero Data Retention.
3. Add the key to Vercel as `GROQ_API_KEY`, marked sensitive. It has no `VITE_` prefix, so it stays on the server.
4. Optionally set `GROQ_MODEL` to use a different model that reads images. The default is `qwen/qwen3.8-27b`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app locally |
| `npm test` | Runs the tests, including the database security rules |
| `npm run build` | Checks types and builds for production |

## House rules

- **No third-party assets:** fonts, scripts, MediaPipe's WebAssembly and the face model are served from this project, never from a font service or CDN. The content security policy in `vercel.json` enforces this in production.
- **No personal data in the repo:** clothing photos and secret keys never get committed.
- **Rules live in code:** wear counts, rotation and variety are enforced by code. AI only chooses among the pieces the code allows, and its answers are checked before they're saved.

## Credits

- Set in [Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type, used under the SIL Open Font License. See `src/assets/fonts/OFL.txt`.
- Face detection by [MediaPipe](https://github.com/google-ai-edge/mediapipe) and its BlazeFace model, under the Apache License 2.0.
