# Overview Redesign — Bento Launcher with Live Numbers

This redesign turns the EduConnect Pro Overview page into a colourful 4-column bento launcher. A row of live business numbers sits on top, and the Dashboard gets a large featured tile.
It follows the suggested "Workspace Modules" design. All existing destinations, search, live alert badges and permissions stay.

## Who it's for
- Super admins, who see every module across the business.
- Office admins, who see only their own office's modules and numbers.
- Staff and sub-agent accounts are not affected. They keep their current dashboards.

## Core features and experience
- **Key numbers row (4 cards):** Total leads, Admissions, Collections this month (in the workspace currency, short format such as ₹12.8L) and Pending tasks. Pending tasks counts follow-ups due, new applications and pending approvals together. Office admins see figures for their own office only. Each card opens the matching page: Leads, Students, Transactions and the CRM follow-ups.
- **Bento module grid:** 4 columns on desktop.
  - A large featured **Dashboard** tile spans 2 columns. It carries an "Overview" tag, the line "Business analytics and performance" and an "Explore workspace →" link.
  - The remaining modules appear as smaller tiles, each with a coloured icon, the module name and a short one-line description. Section tiles (Accounts, Office, Add details) still open their section pages.
- **Per-module colours:** each module gets its own accent from the palette Indigo #5969E8, Violet #9176E8, Cyan #38A8CE, Emerald #27A783, Amber #E5A342 and Coral #E47785. The brand red (the custom Branding colour) stays for buttons, active states and alert badges.
- **Kept as is:** the search bar ("/" to focus, Enter opens the first match), the live red alert badges ("3 due", "1 to do") and permission and module filtering.
- **Section pages** (Accounts, Office, Add details) get the same tile style and colours.

## User flow
1. An admin signs in and lands on Overview.
2. The greeting appears ("Good evening, Muneer — Your education business at a glance."), then the 4 live numbers.
3. The admin scans the colourful module grid. Red badges show what needs attention.
4. Tapping a tile opens that page, and tapping a section tile opens its own tile page. Typing in the search bar filters straight to any page, including pages inside sections.

## Layout reference (desktop)
A clickable mockup is saved at `/app/plan/overview-mockup.html`. Its numbers are sample data.

```
GOOD EVENING
Hi Muhammed.                                   
Your education business at a glance.

┌───────────┐ ┌───────────┐ ┌──────────────┐ ┌───────────┐
│ 👥 indigo │ │ 🎓 emerald│ │ ₹  amber     │ │ ⏱ coral   │
│ 1,284     │ │ 186       │ │ ₹12.8L       │ │ 24        │
│ Total leads│ │ Admissions│ │ Collections  │ │ Pending   │
└───────────┘ └───────────┘ └──────────────┘ └───────────┘
[ 🔍 Search pages… (press / to focus) ]

Workspace modules
┌─────────────────────────────┐ ┌─────────────┐ ┌─────────────┐
│ 📊 (indigo)       [Overview]│ │ Admission   │ │ Accounts    │
│ Dashboard                   │ │ Revenue     │ │  [4 pages]  │
│ Business analytics…         │ │ (amber)     │ │ (amber)     │
│ Explore workspace →         │ └─────────────┘ └─────────────┘
└─────────────────────────────┘
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Messages    │ │ Clients     │ │ Students    │ │ Office      │
│ ●3 unread   │ │ (cyan)      │ │ (emerald)   │ │ ●1 to do    │
│ (coral)     │ │             │ │             │ │ (violet)    │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Add details │ │ Team        │ │ Customize   │ │ Settings    │
│ (cyan)      │ │ (indigo)    │ │ (violet)    │ │ (slate)     │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

## UI/UX feel
- Clean light cards on a soft background, with rounded corners, thin borders and gentle shadows. Tiles lift on hover, and the grid fades in tile by tile.
- Calm, colour-coded and easy to scan. Colour helps tell modules apart instead of every icon being red.
- The featured Dashboard tile has a soft tinted background so it stands out.
- Dark mode is supported with the same accents on dark cards.
- On mobile:
  - the number cards show in a 2×2 grid
  - the module grid becomes 2 columns
  - the featured tile spans the full width.

## Implementation phases
**Phase 1 — MVP (built now)**
- Live key-numbers row (4 cards) with role-aware figures.
- 4-column bento grid with the featured Dashboard tile.
- Per-module colour palette, with brand red kept for actions and alerts.
- Same tile style on the section pages, with search and live badges kept.

**Phase 2**
- Admins can pick which 4 numbers appear and drag tiles to reorder them.
- Small trend arrows on the number cards (up or down compared with last month).

**Phase 3**
- Favourite (starred) tiles that are always shown first.
- A "Recent pages" row and a personalised module order based on usage.

## Assumptions
- The palette colours are assigned to modules automatically and stay the same each time. Similar modules share related tones, for example the finance modules use Amber.
- Collections means money received this calendar month, in the workspace currency.
- Total leads and Admissions are all-time counts that follow the academic year selector when a year is chosen.
- The Branding page colour still drives buttons, highlights and alerts. It no longer colours the tile icons.
- Tile icons stay as the current icon set, in the new colours. No custom 3D artwork is added.
- Staff and sub-agent dashboards are unchanged.
