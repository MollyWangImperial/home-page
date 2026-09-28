# Settings content

The settings reader uses verbatim copies of these supplied files, imported on 28 September 2026:

- `D:/repos/rehyn-website-static/src/content/legal-content.ts` → `client/src/content/legal-content.ts`
- `D:/repos/rehyn-website-static/src/content/data-permissions.ts` → `client/src/content/data-permissions.ts`

The copies are bundled locally so the app does not depend on a developer's D: drive at runtime. Update them from the source documents when those documents change. The source's version, unconfirmed effective date, and bracketed placeholders are preserved in the content files. The reader displays the document introductions and sections without version metadata or additional draft and preview notices.

Profile details use the app's existing Molly and Dr. Jack demo identities. No email address is invented. Viewing this panel does not record acceptance of terms, change consent, request device permissions, or send account information. Profile editing and live consent controls require a connected account service and are outside this read-only view.

The settings button appears below Warning signs in the desktop sidebar and beside the logo at the top left below the existing 620px mobile breakpoint. The profile avatar opens the same view. The dialog uses Radix focus trapping, Escape dismissal, and focus restoration to the button that opened it.
