# Setup Copilot Instructions

## Brief project description
- Project name: **Map tracking tourism TKX**.
- Purpose: web app for tracking mountain trips of the dance club **"ТК Хоро и приятели"** with map pins, trip metadata, and image galleries.
- Main language in UI: Bulgarian.
- Main flows: browse locations on map and right-side list, filter/group by seasons, open galleries, and manage data based on user role.

## Architecture and technology stack
- Frontend: static multi-page app with **HTML + CSS + vanilla JavaScript**.
- Mapping: **Leaflet** with OpenStreetMap tiles.
- Backend: **Supabase** (Postgres, Auth, Storage, RLS, SQL RPC functions).
- Client SDK: `@supabase/supabase-js` loaded via CDN.
- Structure:
  - `index.html`, `styles.css`, `app.js` for the main app.
  - `admin/admin.html`, `admin/admin.css`, `admin/admin.js` for admin panel.
  - `supabase/migrations/*.sql` for schema, policies, and database functions.
  - `Images/` for local image assets/source files.

## UI guidelines
- Keep existing responsive layout: map on the left/main area and locations list in sidebar.
- Preserve existing visual style and CSS classes; extend current styles instead of introducing a new design system.
- Keep all user-facing text in Bulgarian unless explicitly requested otherwise.
- Mobile behavior is important:
  - hamburger menu in hero header,
  - touch-friendly buttons and controls,
  - avoid overlays blocking taps,
  - location popup interactions should not break map usability.
- Preserve existing interaction patterns:
  - modal for create/edit/delete/login/register,
  - toast notifications for successful actions,
  - coordinates displayed with 4 decimal places.

## Pages and navigation guidelines
- Main entry page: `index.html`.
- Admin page: `admin/admin.html` (accessed from the Admin button only for authorized users).
- Main menu items are handled by `data-menu` actions in `app.js` (locations, seasons, users, admin, login, register).
- Keep navigation simple:
  - unauthenticated users can browse public data,
  - authenticated users can access role-based actions,
  - admin panel remains separate and guarded.
- Do not add extra pages unless the task explicitly requires it.

## Backend and database guidelines
- Source of truth is in Supabase migrations under `supabase/migrations`.
- Core tables:
  - `public.location_lists`
  - `public.locations`
  - `public.user_roles`
- `public.locations` includes (at minimum):
  - `list_id`, `owner_user_id`, `title`, `description`, `latitude`, `longitude`
  - `season`, `visit_date`, `mountain`, `elevation_m`
  - `popup_image_path`, `title_image_path`, `image_paths`
- Storage bucket: `location-images`.
- Image path convention supports public folders like `public/<Location Folder>/<file>`.
- Keep DB changes migration-first:
  - add a new SQL migration for schema/policy/function changes,
  - avoid manual schema drift,
  - keep constraints and RLS policies explicit.

## Authentication and authorization guidelines
- Auth provider: Supabase Auth.
- Role model: `visitors`, `publisher`, `editor`, `admin` (enum `public.app_role`).
- Role lookup helpers: `public.current_app_role()` and `public.is_admin()`.
- RLS expectations:
  - read access for locations/lists is public in current setup,
  - publishers manage only their own list/location content,
  - editors can modify locations according to current RLS and app rules,
  - admins have full access and can manage users.
- Admin-only RPC functions include user listing/role changes and account actions (e.g. password reset, soft-delete).
- Frontend must never contain secrets:
  - publishable key is allowed,
  - never add service-role keys or private credentials in client files.
- Keep authorization checks in both places:
  - database (RLS/RPC security definer logic),
  - UI (hide/disable unauthorized actions).
