# Wardrobe planner

A private web app that plans a Monday to Sunday of outfits from photos of your own clothes. It tracks what's been worn and what's clean, and a piece only comes back into outfits once it has been washed.

**Status:** phase 1 of 6. Sign-in and the app shell work. Wardrobe, planner, style and hand control are still to come.

## Stack

- React, TypeScript and Vite
- Supabase for sign-in, and later for data and photos
- Vercel for hosting

## Run it locally

You need Node 22 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in both values in `.env.local`, then start the app:

```bash
npm run dev
```

Without those values, the app shows a screen explaining what's missing.

## Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Under **Authentication > Sign In / Providers**, turn off **Allow new users to sign up**. This app has one user.
3. Under **Authentication > Users**, add your user with **Auto Confirm User** ticked.
4. Copy the project URL and the publishable key into `.env.local` and into Vercel's environment variables.

Only ever use the publishable key or the legacy anon key. These values ship to the browser, so the build stops if it finds a secret key.

If you forget your password, reset it from the Users page in Supabase.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app locally |
| `npm test` | Runs the tests |
| `npm run build` | Checks types and builds for production |

## House rules

- **No third-party assets:** fonts, scripts and images are served from this project, never from a font service or CDN. The content security policy in `vercel.json` enforces this in production.
- **No personal data in the repo:** clothing photos and secret keys never get committed.
- **Rules live in code:** wear counts, rotation and variety are enforced by code. AI only chooses among the pieces the code allows.

## Credits

Set in [Archivo](https://github.com/Omnibus-Type/Archivo) by Omnibus-Type, used under the SIL Open Font License. See `src/assets/fonts/OFL.txt`.
