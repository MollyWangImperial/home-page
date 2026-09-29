# New User Welcome: Visual QA

final result: passed

Scope: the requested local welcome-page design, not a production onboarding flow.

## Assessment Button Motion

- Added a low-contrast light sweep and a 4px arrow nudge on a slow 6.4-second
  cycle. Hover/focus stops the idle motion and highlights the action; pressing
  gives a 1px response. Reduced-motion styles remove motion and the light sweep.
- Live computed-style samples confirmed changing arrow/sweep transforms. Button
  dimensions remained fixed. At 320px, the document client/scroll widths matched
  at 305px and the 223px-wide, 55px-high button had no content overflow.
- Keyboard focus and Enter activation verified; the existing assessment-service
  dialog remains unchanged. TypeScript, build and all 36 tests pass.
- Proof: `C:/Users/LENOVO/Documents/New project/rehyn-welcome-animated-start.png`

## Latest Annotation Revision

- Removed the total time estimate, all three step descriptions and durations,
  and the assessment panel's "Talk with Alira first" button.
- Replaced the seedling with the existing AliraAvatar logo. Its breathing and
  travelling heartbeat trace are scoped to the welcome page. Read-only browser
  samples confirmed changing transforms and stroke offsets. Reduced-motion CSS
  disables both animations; OS reduced-motion emulation was not available.
- Retained three numbered titles, centered within their rows, and made the
  primary action full width. No returning-home or shared-avatar source edits.
- Browser checks: all marked copy absent, exactly three step titles and one
  panel action; no console errors. The start button still opens the existing
  unavailable-assessment dialog when no assessment service URL is configured.
- Checked a 1191px desktop layout and 390px mobile layout, plus 320px with larger
  text. At 320px, client/scroll widths both measured 305px and no welcome text
  overflowed. Restored standard text and the normal browser viewport afterward.
- TypeScript, all 36 tests, and production build pass. Existing >500kB bundle
  warning remains. No deployment or push performed.
- Updated preview: `http://127.0.0.1:4203/welcome`
- Current capture: `C:/Users/LENOVO/Documents/New project/rehyn-welcome-alira-updated.png`
- Mobile capture: `C:/Users/LENOVO/Documents/New project/rehyn-welcome-alira-mobile.png`

The comparison history and original captures below document the prior reference
implementation; the removals and logo replacement above supersede that artwork
and copy.

## Evidence

- Source: `C:/Users/LENOVO/AppData/Local/Temp/codex-clipboard-ddf27565-c586-4e5c-8b2e-15e1e1508b1f.png`
- Desktop: `C:/Users/LENOVO/Documents/New project/rehyn-new-user-desktop.png`
- Mobile: `C:/Users/LENOVO/Documents/New project/rehyn-new-user-mobile.png`
- Existing dashboard: `C:/Users/LENOVO/Documents/New project/rehyn-returning-home-preserved.png`
- URL: `http://127.0.0.1:4203/welcome`
- Source and final desktop capture: 1440 x 960 pixels, 1440 x 960 CSS viewport.
  Compared together in the same image-view tool input, without crop or scaling.
- Additional checks: 390 x 844 mobile, 320 x 740 mobile with larger text.
- State: new-user welcome, standard text, normal contrast, dialogs closed.

## Comparison History

1. Initial comparison: the assessment panel was approximately 18px taller than
   the reference because of row and button padding. Tightened row padding, button
   line height and padding, and the gap above the panel.
2. Mobile check: hiding the desktop line break merged "Alira" and "first".
   Added an explicit word space. Verified the updated visible button label.
3. Small mobile check: the existing global 320px minimum width caused horizontal
   scroll when a desktop scrollbar occupied part of that viewport. Overrode the
   minimum only while the welcome screen is mounted. Final client and scroll
   widths both measured 305px in the 320px test; no overflowing text elements.
4. Final full-view comparison: panel at x477, y438.25, width720, height396.7 CSS
   pixels, versus the reference's approximately x477, y438, width720, height393.
   All major regions and intended content fit. Remaining small metric and icon
   differences are P3; no further region crop was needed at this resolution.

## Fidelity

- Typography: existing Newsreader display face and DM Sans body face retained;
  48px desktop welcome heading, 28px panel heading, 16px step titles, 14px body.
  Zero letter spacing; mobile heading 36px and longer text wraps normally.
- Layout: 234px sidebar, centered 720px panel, 124px Alira logo, three
  numbered title rows and one full-width action. Mobile logo is 98px.
- Colors: dark green sidebar, off-white canvas, muted green secondary text,
  terracotta primary button, restrained borders. Existing controls/icons reused.
- Artwork: existing Alira SVG logo reused, with slow breathing and a travelling
  heartbeat highlight. The seedling bitmap is no longer rendered.
- Copy: welcome introduction and step titles retained. Descriptions and timings
  removed per annotations. The preview cannot save assessment answers, so the
  pause note says "Go at your own pace" instead of claiming answers are saved.

## Interaction Verification

- Start my assessment opens an accessible Radix dialog when no assessment URL is
  configured. This states the service is unconnected; no fake completion occurs.
- Talk with Alira opens the existing `/alira?onboarding=1` demo. Home returns to
  `/welcome`, and Journey/My time remain marked disabled in this context.
- Locked navigation is unavailable in the browser's accessible controls.
- Settings and Warning signs open; their close controls work.
- Larger text and contrast controls work; 320px larger-text wrapping verified.
- Old `/` dashboard still shows its original progress, check-in, and sidebar.
  `Home.tsx` has no edits. No patient data or completed assessments were created.
- No browser console errors observed. TypeScript, build and 36 tests pass.
- Build emits the existing-style warning for a JavaScript chunk over 500kB.

## Integration Limitations

The existing app is a demo with hard-coded Zak/profile/history content. It has
no patient sign-in or assessment-history service. `/welcome` is an explicit new
route, not an automatic patient-state decision; `/` remains unchanged. Configure
an approved HTTPS `VITE_ASSESSMENT_URL` and connect real authenticated assessment
status before shipping this as a complete new-patient onboarding experience.
Alira's existing demo conversation and care-team content are unchanged.
No deployment or push was performed.
# Alira guided start: visual and interaction QA

final result: passed

The Alira page matches the selected design in the existing local website. Existing welcome-page work is preserved.

## Evidence

- Source: `C:/Users/LENOVO/Downloads/Alira A · Guided start in the chat (recommended)@1x.png`
- Final desktop: `C:/Users/LENOVO/Documents/Codex/2026-09-29/d-repos-rehyn-recovery-companion/outputs/alira-desktop.jpg`
- Small mobile: `C:/Users/LENOVO/Documents/Codex/2026-09-29/d-repos-rehyn-recovery-companion/work/alira-small-mobile.png`
- Mobile composer: `C:/Users/LENOVO/Documents/Codex/2026-09-29/d-repos-rehyn-recovery-companion/work/alira-mobile-composer.jpg`
- URL: `http://127.0.0.1:4203/alira`
- Source and implementation: 1440 x 960 pixels, 1440 x 960 CSS viewport. Browser capture output matches the source size; no additional scaling or cropping.
- State: initial conversation, normal appearance, dialogs closed.
- The source and final desktop capture were opened together in the same comparison input. All text and controls were readable, so no additional detail crop was needed.
- Mobile checks: 390 x 844 and 320 x 740. Client and scroll widths match at 375 and 305 pixels respectively, accounting for the browser scrollbar.

## Comparison history

1. P2: help panel was about 6 pixels too tall, causing a page scrollbar and shifting the columns. Reduced heading margin and card padding. Final chat: x56/y312.8, 908 x 616. Help panel: x984/y312.8, 400 x 437.8. Desktop document height is 960.
2. P2: global HTML minimum width caused horizontal overflow at 320 pixels. Scoped an override to this page. Client and scroll widths now both measure 305 pixels.
3. P2: shared-shell styles overrode the intended canvas colour. Increased scoped specificity and sampled the reference palette. Recaptured and compared the final desktop page after correction.
4. P3 refinements: tightened title metrics and first response-button width; retained word spaces when mobile line breaks are hidden.

## Required fidelity surfaces

- Typography: Newsreader headings and DM Sans body; 16px/24px chat copy retains the reference wrapping. Minor browser rasterization differences are P3.
- Layout: full-width canvas, 56px desktop margins, 20px gutter, 400px side column, 616px chat height and anchored composer. Safety card differs by approximately 1px (P3).
- Colours: sampled canvas #f4f3ee, cards #fbfaf7, first-step panel #e4eee2, bubbles #dcebe0 and primary action #ad5a37.
- Assets: standard interface symbols use the existing Lucide library. No photographic or illustrated assets require generation. Minor icon-path differences are P3.
- Copy: initial greeting, invitation, headings, durations and safety text match the reference. Additional replies appear after interaction.

No actionable P0/P1/P2 findings remain.

## Verification

- Both assessment buttons use the existing configured integration or show its unconnected-service dialog. Closing restores focus to the invoking control.
- How does it work, all four topic cards and Not right now produce their intended chat replies.
- Desktop/mobile message entry, empty-send disabling, reply state and chat scrolling verified.
- Warning-signs dialog opens and closes with existing safety copy.
- Device read-aloud starts and returns to idle without an audio error. The voice status endpoint returns valid JSON with configured:false; the device fallback was exercised. Only fixed Alira copy enters TTS.
- Dictation has browser support and error handling, and places words in the draft for review. Actual microphone capture and external recognition availability were not tested.
- Header home navigation preserves onboarding context; mobile navigation and locked onboarding destinations remain available as before.
- TypeScript passes. Existing 28 tests and 8 additional phrase-allowlist cases pass across focused runs. Production build passes with its existing large-bundle warning.
- Console checked: an intermediate HMR missing-import error occurred while the stylesheet was being created and was resolved. No later runtime errors appeared during verification or final reload.

## Limits

The assessment service is still unconnected in this preview. A configured HTTPS VITE_ASSESSMENT_URL is used when present. Chat uses local preview replies. No assessment completion, patient-data persistence, deployment or push was performed.

## Checklist

- [x] Match the selected desktop design.
- [x] Verify responsive layouts and primary controls.
- [x] Preserve existing welcome-page work.
- [x] Keep the local preview available.
