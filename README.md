# Unlisted

Unlisted helps recruiters find candidates, including the ones they can't find on LinkedIn. A recruiter uploads or pastes a job description, Claude turns it into a brief, and Unlisted searches two sources: GitHub, for people found through their public work (many of them not on LinkedIn), and LinkedIn profiles through People Data Labs, a licensed data provider. Recruiters review each candidate against the brief with the evidence shown, approve or skip them, and draft a first message that cites the person's work.

## What's in this first version

- **Recruiter accounts:** sign up, log in and log out. Passwords are hashed with bcrypt and sessions are signed cookies.
- **Roles from a job description:** PDF, Word (.docx), text or pasted. Claude reads it into must-haves, nice-to-haves, locations, pay, work authorization and search terms. Recruiters switch requirements between must-have and nice-to-have before saving. Without an Anthropic key, a keyword reader is used instead.
- **Candidate search on GitHub:** repositories matching the brief's search terms, plus people by language and city. Each person is scored line by line against the brief. Seniority is never guessed from public data; it's marked "ask in your first conversation".
- **Review queue:** approve or skip with a reason, with keyboard shortcuts (J/K, A, S then 1–4, M). Skipping someone for their location stops that location appearing for the role.
- **Message drafts:** Claude writes a short first message citing the person's work and your pay range. An opt-out line is always added.
- **Privacy:** a privacy notice at `/privacy` and an opt-out at `/opt-out` that deletes the person and stops them being found again.

## Run it locally

You need Node 22 and a Postgres database.

```bash
npm install
cp .env.example .env   # then fill in the values
npx prisma db push
npm run dev
```

Open http://localhost:3000 and create an account.

## Put it online with Netlify

1. Create a free Postgres database on [Neon](https://neon.tech) and copy its pooled connection string.
2. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick this repository. The build settings come from `netlify.toml`.
3. Under **Site configuration → Environment variables**, add:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon's pooled connection string |
| `DATABASE_URL_UNPOOLED` | Optional: Neon's direct connection string, used for schema changes during builds |
| `AUTH_SECRET` | At least 32 random characters. Generate one with `openssl rand -base64 48` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. Lets Claude read job descriptions and draft messages |
| `GITHUB_TOKEN` | A GitHub personal access token with no scopes. Raises GitHub's limits from 60 to 5,000 requests an hour |
| `PDL_API_KEY` | Optional: a [People Data Labs](https://www.peopledatalabs.com) API key. Adds LinkedIn profiles to searches. Each profile returned uses one credit (up to 10 per click); the free plan has about 100 a month |
| `APP_URL` | Your site's address, for example `https://unlisted.ai`. Used in the opt-out link in messages |
| `PRIVACY_EMAIL` | The address people write to about their data, shown on the privacy page |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional: email recruiters when the agent finds new people, through [Resend](https://resend.com). `EMAIL_FROM` must use a domain verified with Resend |

4. Deploy. Production builds run `prisma db push` first, so the database tables are created automatically.

## How the search works

Each click on **Find candidates** runs a small batch, which keeps it inside a web request's time limit: up to 3 GitHub searches and 12 people, plus up to 10 LinkedIn profiles from People Data Labs when `PDL_API_KEY` is set. People found but not yet looked at are kept for the next click.

Unlisted never scrapes LinkedIn itself: LinkedIn sues scrapers, and Proxycurl shut down in 2025 after it was sued. Someone found on both GitHub and LinkedIn is stored once, and every candidate is marked **On LinkedIn** or **Not on LinkedIn**. Profiles are cached for a week. People who opted out are never fetched or shown.

Scores combine must-haves (weight 3), nice-to-haves (weight 1) and location, plus a small bonus for GitHub stars and recent activity. People outside the role's cities (or outside the US for remote roles), and people meeting fewer than half of the checkable must-haves, are kept out of the queue. A language counts when it's one of someone's main languages on GitHub or listed as a skill on their profile.

## The sourcing agent

When a recruiter creates a role or clicks **Find candidates**, the quick search above shows the first people within seconds, and the sourcing agent starts in the background. It needs `ANTHROPIC_API_KEY`.

- **Where it runs:** a Netlify background function (`netlify/functions/agent-background.mts`), which may run for up to 15 minutes. It only drives the conversation with Claude; every step goes through the app's own agent API (`src/app/api/agent`), which does the searching, checking and saving. The two authenticate with a per-run token derived from `AUTH_SECRET`.
- **What it does:** it reads the brief and what the recruiter approved and skipped, plans searches on GitHub and LinkedIn, looks closely at promising people, and adds the best to the review list with a note on why they fit and an opening line for a message. The role page shows its progress live, and new candidates appear as they're added.
- **Its checks:** every candidate it adds is checked by code, not by the model. Their location must fit the role, they must meet enough of the must-haves, and every piece of evidence the agent cites must appear in their actual profile. Anything else is rejected and the agent is told why.
- **Questions:** when a choice would change the role, such as allowing remote, it asks instead of assuming. The recruiter answers Yes or No on the role page, and a Yes changes the brief.
- **Limits per run:** 12 minutes, 30 tool calls, 30 people looked at, 8 GitHub searches, 20 LinkedIn profiles and 10 people added, plus 6 manual runs per role a day. Its prompt is cached between steps to keep costs down.
- **Nightly top-up:** with "Keep searching every night" switched on under a role's Details, `netlify/functions/agent-nightly.mts` starts a run at 10:00 UTC each day, and the recruiter gets an email when there's someone new (with Resend set up).
- **What it never does:** send messages, decide for the recruiter, or use or guess age, gender, race, religion, national origin, disability or visa status.

## Before launching with real people's data

- Have a US privacy lawyer review the privacy notice and your obligations. Selling access to profiles of people you have no relationship with is likely to make you a data broker, which means registering in California, Texas, Vermont and Oregon and processing deletion requests from California's DROP system.
- Keep it a sourcing tool, not a screening tool. Your terms should forbid using profiles to decide someone's eligibility for a job, which would bring in the Fair Credit Reporting Act.
- Follow GitHub's terms for API use, and only send messages people can easily opt out of.

## Next

- Using the "companies to target or avoid" and "someone like the person you want" answers in the search.
- More sources: research papers (OpenAlex), US patents (PatentsView) and professional directories.
- Sending from the recruiter's Gmail or Outlook, and a pipeline view.
- The recruiter network and split board from the prototype.
