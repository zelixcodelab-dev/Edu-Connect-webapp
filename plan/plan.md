# Sidebar Redesign — Frosted Glass Menu (Dribbble "Side menu Bar" style)

The EduConnect Pro sidebar is restyled to match the referenced Dribbble design: a light frosted-glass panel floating over a soft gradient background, with labelled sections, a built-in search and a profile card at the bottom.
It has a matching icon-only collapsed state. All existing pages, sections, permissions, alerts and modules stay as they are.

## Who it's for
- Everyone who uses the desktop or mobile sidebar: super admins, office admins, staff and sub-agent accounts. Each person still sees only the pages they can access.

## Core features and experience
- **Frosted glass panel:** the sidebar floats as a rounded, slightly see-through card with a soft blur and gentle shadow, set a little away from the screen edges.
- **Soft gradient background:** the whole app background gets a light tinted gradient that shows through the glass. It is tinted with the brand colour, and dark mode uses a matching deep version.
- **Header:** company logo and name at the top, with the collapse/expand button beside them.
- **Search box:** a rounded "Search menu…" field under the header filters the menu items as the user types. The existing menu search is kept.
- **Labelled sections:** small uppercase headings in grey, such as WORKSPACE, ACCOUNTS, OFFICE, PEOPLE and SETTINGS, with clear spacing between groups. Existing groups (Accounts, Office, Add details) still expand and collapse. Clicking a group name still opens its section page.
- **Menu items:** thin line icons in grey with the label beside them, roomy rows and rounded corners.
  - **Selected item:** a filled rounded pill in the brand colour with white icon and text, plus a small brand-colour bar on its left edge, as in the sample.
  - **Hover:** a light tint.
- **Alerts kept:** red dots and counts (unread messages, follow-ups due, pending approvals) stay on their items.
- **Profile card at the bottom:** the user's photo or initials, name and email inside a rounded glass card, with a sign-out button. Tapping the card opens the profile.
- **Collapsed state:** a narrow icon-only glass rail, matching the sample's second panel. Section headings shrink to short dividers, the search becomes an icon, and the profile card becomes an avatar with a sign-out icon below. Tooltips show the item names.
- **Mobile:** the slide-out menu uses the same glass panel, sections, search and profile card. The bottom tab bar is unchanged.

## User flow
1. A user signs in and sees the glass sidebar on the left of the gradient background.
2. They scan the labelled sections or type in the search box to find a page.
3. The current page is shown as a brand-colour pill.
4. They collapse the sidebar to the icon rail when they want more room and expand it again with the same button. The choice is remembered.
5. At the bottom they can open their profile or sign out.

## UI/UX feel
- Light, airy and calm, with lots of spacing, large rounded corners, thin borders and soft shadows.
- The brand colour (set on the Branding page, currently red) is used only for the selected item, alert counts and buttons, so it stands out.
- Smooth animations when collapsing or expanding, and when the selected pill moves between items.
- Dark mode supported: a dark glass panel on a deep gradient, with the same brand-colour pill.

## Implementation phases
**Phase 1 — MVP (built now)**
- Frosted glass sidebar on the soft gradient background, for desktop and the mobile menu.
- Header, search box, labelled sections, brand-colour selected pill, alert badges and profile card with sign out.
- Matching icon-only collapsed rail.
- Light and dark mode.

**Phase 2**
- Pinned favourite pages in their own section at the top of the menu.
- Admins can reorder menu sections.

**Phase 3**
- Optional background styles on the Branding page (plain, gradient or a custom image behind the glass).
- A personal "recently visited" section in the menu.

## Assumptions
- The selected item uses the workspace brand colour, not the sample's pink.
- The gradient background applies to every page inside the app. The login page and the public application form stay as they are.
- The sample's "Teams" list and "Upgrade plan" card are left out because they don't match this app. The profile card takes the bottom spot instead.
- Section headings follow the existing menu groups. Labels may be lightly renamed for clarity, but no page moves to a different section.
- The current icon set stays, shown as thin line icons.
- The mobile bottom tab bar and top bar keep their current layout, apart from picking up the new background.
