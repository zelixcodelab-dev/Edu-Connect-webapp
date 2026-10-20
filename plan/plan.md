# EduConnect Pro — Full KMConnect Feature Sync + Guided Tour

Brings every remaining new or changed feature from the uploaded KMConnect repository into the multi-tenant EduConnect Pro SaaS, without breaking the SaaS login, per-company data isolation or the Platform Console.
Adds a guided product tour, with a Skip option, so new client users can learn the app on their first visit.

## Who it's for
- **Platform Owner**: decides which features each client company gets.
- **Client company admins and staff**: use the CRM day to day, and new users are shown the app through the tour.

## Core features and experience
1. **Remaining KMConnect updates, ported one at a time**
   - Every feature or change in the uploaded repo that isn't in EduConnect Pro yet gets listed, then adapted to work per company.
   - Already merged and kept as they are: Attendance + Payroll, Academic Year selector, Google Sheets sync, Passkey login.
   - Repo files never replace the app's own sign-in, company isolation, permissions or Platform Console behaviour. Each feature is merged into the current app.
   - If a change only made sense in the single-company repo (e.g., its own login/database setup), it is left out and listed in the final report.
2. **Per-company feature switches**
   - Each new feature appears as a module in the Platform Console → Clients → company modules.
   - The owner can turn it on or off for each company. When it's off, the feature disappears from that company's menu and its pages and data can't be reached.
   - Existing companies keep the features they already use. Newly ported features start **on** for existing companies and can be switched off.
3. **Leave cleanup**
   - The Staff Dashboard "Leave" tile opens Attendance on its Leave tab.
   - All remaining links to the old standalone Leave page are pointed there instead.
4. **Guided tour for new users**
   - Starts automatically the first time someone signs in to a company workspace.
   - Step-by-step highlights cover the main areas: navigation, dashboard, students/leads, attendance, academic year selector, messages and settings.
   - Each step has Next, Back and **Skip tour**. A finished or skipped tour won't start again on its own.
   - It can be replayed any time from a "Take the tour" option in the profile/help menu.
   - Steps match the user's role (admin vs staff) and only cover features enabled for their company.

## User flow
- **Owner**: opens Platform Console → Clients → picks a company → switches modules on/off → the change shows in that company's app at the next page load.
- **New client user**: signs in → the tour starts → they step through it or press Skip → they land on their dashboard → they can replay the tour later from the menu.
- **Staff**: Dashboard → Leave tile → Attendance (Leave tab) → apply for or view leave.

## UI/UX feel
- Matches the current EduConnect Pro look and each company's branding (logo and colours).
- The tour uses a soft spotlight on the highlighted element and a compact card showing step progress (e.g., "3 of 7"), with Skip always visible. It works on mobile, where it highlights the bottom navigation.

## Implementation phases
- **Phase 1 (MVP, built now)**
  - Inventory and port of all remaining KMConnect features, adapted to multi-tenant.
  - Each feature registered as a per-company module.
  - Leave tile/link cleanup.
  - Role-aware guided tour with Skip and replay.
- **Phase 2**
  - Owner-editable tour content per company (custom steps and text).
  - Short tours on individual pages (e.g., the first visit to Payroll).
- **Phase 3**
  - Onboarding checklist for new companies (add first student, invite staff, connect Google Sheets).
  - Tour completion stats in the Platform Console.

## Assumptions
- "Remaining features" means anything in the uploaded repo that EduConnect Pro doesn't have, or has in an older version. Where the two versions differ, the app's current multi-tenant version wins, and only the new behaviour is added on top.
- Ported features start enabled for existing companies, and the owner can switch them off.
- The tour runs once per user, not once per company. Skipping counts as completed.
- Tour text is in English.
- The Leave feature (backend and the Attendance Leave tab) stays. Only the standalone page route is gone.
- Onboarding the new customer company is not part of this round. The owner will do it via Clients → Add company.
- Google Sheets stays in "not configured" mode until OAuth credentials are provided. Passkeys still need testing on a real device on educonnectpro.app.
