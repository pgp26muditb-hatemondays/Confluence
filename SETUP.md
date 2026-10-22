# Adhik website + Sales CRM: Vercel setup

## Files
- index.html      Website, Sales CRM and AI lead finder (single page)
- og-image.jpg    Preview image for WhatsApp and LinkedIn links
- api/chat.js     Server function that calls Gemini. The API key stays here, never in the browser.

## Steps
1. Upload all three items to the root of the Vercel project, keeping the `api` folder, and deploy.
2. In Vercel, open Project → Settings → Environment Variables and add:
   - GEMINI_API_KEY = your key from Google AI Studio (required)
   - CRM_PASSCODE   = a short team passcode (recommended, so strangers cannot use your quota)
   - ALLOWED_ORIGIN = https://confluence-snowy-kappa.vercel.app (recommended)
   - GEMINI_MODEL   = optional; defaults to gemini-3.8-flash
3. Redeploy so the variables take effect.
4. Open the site → Sales CRM → 5 · AI lead finder, enter the passcode once, and ask a question.

## Notes
- Never paste the API key into index.html, a chat or a slide.
- Answers use Google Search grounding and show sources; verify every company before adding it.
- Grounded search calls may be billed by Google; check your quota in Google AI Studio.
- The rate limit is 20 questions per 10 minutes per visitor.
