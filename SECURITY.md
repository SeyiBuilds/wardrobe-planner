# Security

This is a personal project, but security problems are still worth reporting.

## Reporting a problem

Report it privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it.

## How the app keeps data private

- **Database:** every table has row-level security. A signed-in user can only reach their own rows, and signed-out visitors can't reach any. The rules are tested in `supabase/*.test.ts`.
- **Photos:** clothing photos sit in a private storage bucket, in a folder only their owner can read. Faces are blurred and location details dropped on the device before anything is uploaded.
- **Inspiration pictures:** each one is deleted once the AI has read it. Only the reading is kept.
- **Keys:** the Groq key lives only in the server functions. The browser only ever gets the Supabase publishable key, and the build stops if a secret key is put in its place.
- **Camera:** hand control reads the camera on the device. Nothing from it is recorded, saved or sent.
- **Sign-ups:** off. The app has one user, added by hand in Supabase.
